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

const CAPABILITIES: ChannelCapabilities = {
  outbound: {
    accept_mime: ["text/plain", "text/markdown", "image/*"],
  },
};

export type AgentEventHandler = {
  /** 收到 streaming chunk，accumulated 是当前已积累的完整文本 */
  onMessage?: (record: OutboxRecord, accumulated: string) => void;
  /** 第一个 stream chunk 到来前触发，用于插入消息 header */
  onStreamStart?: () => void;
  /**
   * streaming 结束
   * @param finalText 完整内容
   * @param hadStreamChunks 是否收到过真实的 stream 分片（false 表示服务端一次性返回整块文本）
   */
  onStreamEnd?: (finalText: string, hadStreamChunks: boolean) => void;
  /** tool use / thought / tool result 事件（来自 payload.data） */
  onToolUse?: (event: SessionExecutionEvent) => void;
  onError?: (error: Error) => void;
};

export class AgentClient {
  private requestId = 0;
  private cursor: string | undefined;
  private isProcessing = false;
  private streamStarted = false;    // 是否已插入 stream header
  private hadStreamChunks = false;  // 是否收到过真实 stream 分片
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
    this.streamStarted = false;
    this.hadStreamChunks = false;
    this.accumulatedText = "";

    try {
      const params: ChannelIngressParams = {
        session_key: this.settings.sessionKey,
        text,
        source_kind: this.settings.sourceKind,
        channel_id: this.settings.channelId,
      };

      await this.callRpc("channel.ingress", params);
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

        const result = await this.callRpc<PullResult>("channel.pull", params);
        const records = result.records ?? [];

        if (records.length > 0) {
          for (const record of records) {
            // 处理 tool use 事件（从 payload.data 中提取）
            if (record.payload?.data && typeof record.payload.data === "object") {
              const data = record.payload.data as Record<string, unknown>;
              if (data.type && (data.type === "tool_use" || data.type === "thought_chunk" || data.type === "tool_result")) {
                this.handler.onToolUse?.(data as SessionExecutionEvent);
                continue;
              }
            }

            // 处理文本消息
            if (record.payload?.text !== undefined) {
              const isStreamChunk = record.stream != null && !record.stream.is_final;
              const isFinalChunk = record.stream != null && record.stream.is_final;
              const isNonStreaming = record.stream == null;

              if (isStreamChunk) {
                if (!this.streamStarted) {
                  this.streamStarted = true;
                  this.handler.onStreamStart?.();
                }
                this.hadStreamChunks = true;
                this.accumulatedText += record.payload.text;
                this.handler.onMessage?.(record, this.accumulatedText);
              } else if (isFinalChunk) {
                if (!this.streamStarted) {
                  this.streamStarted = true;
                  this.handler.onStreamStart?.();
                }
                const finalText = this.accumulatedText + (record.payload.text || "");
                const hadChunks = this.hadStreamChunks;
                this.isProcessing = false;
                this.streamStarted = false;
                this.hadStreamChunks = false;
                this.accumulatedText = "";
                this.handler.onStreamEnd?.(finalText, hadChunks);
              } else if (isNonStreaming) {
                if (!this.streamStarted) {
                  this.streamStarted = true;
                  this.handler.onStreamStart?.();
                }
                const text = record.payload.text || "";
                this.isProcessing = false;
                this.streamStarted = false;
                this.hadStreamChunks = false;
                this.accumulatedText = "";
                this.handler.onStreamEnd?.(text, false);
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
    this.streamStarted = false;
    this.hadStreamChunks = false;
    this.accumulatedText = "";
    if (this.pullTimeout !== null) {
      clearTimeout(this.pullTimeout);
      this.pullTimeout = null;
    }
  }

  get processing(): boolean {
    return this.isProcessing;
  }
}
