import { requestUrl } from "obsidian";
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  ChannelIngressParams,
  ChannelPullParams,
  ChannelAckParams,
  ChannelCapabilities,
  PullResult,
  OutboxRecord,
  AgentSettings,
} from "../types";

const CAPABILITIES: ChannelCapabilities = {
  outbound: {
    accept_mime: ["text/plain", "text/markdown", "image/*"],
  },
};

export type AgentEventHandler = {
  onMessage?: (record: OutboxRecord, accumulated: string) => void;
  onStreamStart?: () => void;
  onStreamEnd?: (finalText: string) => void;
  onError?: (error: Error) => void;
};

export class AgentClient {
  private requestId = 0;
  private cursor: string | undefined;
  private isProcessing = false;
  private pullTimeout: number | null = null;
  private accumulatedText = "";
  private handler: AgentEventHandler = {};

  constructor(private settings: AgentSettings) {}

  updateSettings(settings: AgentSettings): void {
    this.settings = settings;
  }

  setHandler(handler: AgentEventHandler): void {
    this.handler = handler;
  }

  /**
   * 使用 Obsidian 的 requestUrl API 发起 RPC 调用
   * 这个 API 绕过了 CORS 限制，直接通过 Node.js 后端发起请求
   */
  private async callRpc<T>(method: string, params: unknown): Promise<T> {
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: ++this.requestId,
      method,
      params,
    };

    try {
      const response = await requestUrl({
        url: `${this.settings.daemonUrl}/rpc`,
        method: "POST",
        contentType: "application/json",
        body: JSON.stringify(request),
        throw: false, // 我们自己处理错误
      });

      if (response.status !== 200) {
        throw new Error(`RPC failed: HTTP ${response.status}`);
      }

      const result: JsonRpcResponse = response.json;
      if (result.error) {
        throw new Error(`RPC error: ${result.error.message}`);
      }
      return result.result as T;
    } catch (error) {
      // 提供更清晰的错误信息
      if (error instanceof Error) {
        if (error.message.includes("net::ERR_CONNECTION_REFUSED")) {
          throw new Error(
            `无法连接到 daemon (${this.settings.daemonUrl})。请确保 duoduo daemon 正在运行。`
          );
        }
        throw error;
      }
      throw new Error(`RPC request failed: ${String(error)}`);
    }
  }

  async sendMessage(text: string): Promise<void> {
    if (this.isProcessing || !this.settings.sessionKey) {
      return;
    }

    this.isProcessing = true;
    this.accumulatedText = "";

    try {
      const params: ChannelIngressParams = {
        session_key: this.settings.sessionKey,
        text,
        source_kind: this.settings.sourceKind,
        channel_id: this.settings.channelId,
      };

      await this.callRpc("channel.ingress", params);
      this.handler.onStreamStart?.();
      this.startPullLoop();
    } catch (error) {
      this.isProcessing = false;
      this.handler.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private startPullLoop(): void {
    const pull = async (): Promise<void> => {
      if (!this.isProcessing) return;

      try {
        const params: ChannelPullParams = {
          session_key: this.settings.sessionKey,
          consumer_id: this.settings.consumerId,
          cursor: this.cursor,
          return_mask: ["final", "stream"],
          wait_ms: this.settings.pullWaitMs,
          channel_capabilities: CAPABILITIES,
        };

        const result: PullResult = await this.callRpc<PullResult>("channel.pull", params);

        if (result.records && result.records.length > 0) {
          for (const record of result.records) {
            if (record.payload?.text) {
              const isStream = record.stream && !record.stream.is_final;

              if (isStream) {
                this.accumulatedText += record.payload.text;
                this.handler.onMessage?.(record, this.accumulatedText);
              } else {
                // Final message
                const finalText = this.accumulatedText + record.payload.text;
                this.handler.onMessage?.(record, finalText);
                this.handler.onStreamEnd?.(finalText);
                this.isProcessing = false;
                this.accumulatedText = "";
              }
            }
          }
        }

        if (result.next_cursor) {
          this.cursor = result.next_cursor;
          await this.callRpc("channel.ack", {
            session_key: this.settings.sessionKey,
            consumer_id: this.settings.consumerId,
            cursor: result.next_cursor,
          } as ChannelAckParams);
        }
      } catch (error) {
        console.error("[AgentClient] Pull error:", error);
        this.handler.onError?.(error instanceof Error ? error : new Error(String(error)));
      }

      if (this.isProcessing) {
        this.pullTimeout = window.setTimeout(pull, this.settings.pullInterval);
      }
    };

    pull();
  }

  stop(): void {
    this.isProcessing = false;
    if (this.pullTimeout !== null) {
      clearTimeout(this.pullTimeout);
      this.pullTimeout = null;
    }
  }

  get processing(): boolean {
    return this.isProcessing;
  }
}
