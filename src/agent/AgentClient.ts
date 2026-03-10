import { requestUrl } from "obsidian";
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  ChannelIngressParams,
  ChannelPullParams,
  ChannelAckParams,
  ChannelCapabilities,
  OutboxRecord,
  SessionExecutionEvent,
} from "@openduo/protocol";
import type { AgentSettings } from "../types";

// PullResult 类型定义（协议包未直接导出）
interface PullResult {
  records?: OutboxRecord[];
  next_cursor?: string;
  idle?: boolean;
}

/** 让出 JS 执行权，允许浏览器完成一次重绘（DOM 更新可见） */
const yieldFrame = (): Promise<void> =>
  new Promise((resolve) => window.requestAnimationFrame(() => resolve()));

const CAPABILITIES: ChannelCapabilities = {
  outbound: {
    accept_mime: ["text/plain", "text/markdown", "image/*"],
  },
};

export type AgentEventHandler = {
  onMessage?: (record: OutboxRecord, accumulated: string) => void;
  onStreamStart?: () => void;
  onStreamEnd?: (finalText: string) => void;
  onToolUse?: (event: SessionExecutionEvent) => void;
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
          return_mask: ["final", "stream", "tool"],
          wait_ms: this.settings.pullWaitMs,
          channel_capabilities: CAPABILITIES,
        };

        const result: PullResult = await this.callRpc<PullResult>("channel.pull", params);

        if (result.records && result.records.length > 0) {
          for (const record of result.records) {
            // 处理 tool use 事件（从 payload.data 中提取）
            if (record.payload?.data && typeof record.payload.data === "object") {
              const data = record.payload.data as Record<string, unknown>;
              if (data.type && (data.type === "tool_use" || data.type === "thought_chunk" || data.type === "tool_result")) {
                this.handler.onToolUse?.(data as SessionExecutionEvent);
                // 每个 tool 事件后 yield 一帧，让 UI 有机会更新
                await yieldFrame();
                continue;
              }
            }

            // 处理文本消息
            if (record.payload?.text !== undefined) {
              const isStream = record.stream && !record.stream.is_final;

              if (isStream) {
                // Streaming chunk: 追加到累积文本，然后 yield 让浏览器重绘
                this.accumulatedText += record.payload.text;
                this.handler.onMessage?.(record, this.accumulatedText);
                // 关键：每个 chunk 处理后让出执行权，浏览器才能看到逐字出现效果
                await yieldFrame();
              } else {
                // Final message: payload.text 是最后一个 delta，追加后完成
                const finalText = this.accumulatedText + (record.payload.text || "");
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
