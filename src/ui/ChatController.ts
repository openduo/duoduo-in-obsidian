import { MarkdownView } from "obsidian";
import { createHash } from "crypto";
import type { OutboxRecord, SessionExecutionEvent } from "@openduo/protocol";
import type { PluginSettings, ChatMessage } from "../types";
import { AgentClient } from "../agent";
import { formatMessageBlock, formatToolUse } from "../markdown";
import { EditorInputBar } from "./EditorInputBar";
import { EditorAdapter } from "./EditorAdapter";
import type { Locale } from "../i18n";
import { t } from "../i18n";

// 基于 notePath 的 MD5 生成符合 [A-Za-z0-9_-]{1,128} 的 channel_id
function makeChannelId(notePath: string): string {
  const raw = notePath && notePath.length > 0 ? notePath : "untitled";
  const md5 = createHash("md5").update(raw).digest("hex"); // 32 个 [0-9a-f]
  return `md5${md5}`; // 前缀 + 32 位 hex，总长 35，符合约束
}

/**
 * 控制层：协调 EditorInputBar（UI）、EditorAdapter（编辑器）、AgentClient（通信）。
 * 持有会话状态，处理发送流程和 agent 响应路由。
 */
export class ChatController {
  private view: MarkdownView | null = null;
  private notePath: string | null = null;
  private inputBar: EditorInputBar | null = null;
  private adapter: EditorAdapter | null = null;
  /** 当前正在进行、但可能还没写入到文档中的 assistant 回复文本（用于 UI 暂不可用时的缓冲） */
  private pendingAssistantText: string | null = null;
  /** 缓冲的 assistant 回复对应的笔记路径，只对同一 note 生效，避免写错笔记 */
  private pendingAssistantNotePath: string | null = null;
  private client: AgentClient;
  private settings: PluginSettings;
  private locale: Locale;

  constructor(settings: PluginSettings, locale: Locale) {
    this.settings = settings;
    this.locale = locale;
    this.client = new AgentClient(settings);

    this.client.setHandler({
      onStreamStart: () => this.handleStreamStart(),
      onMessage: (_record: OutboxRecord, accumulated: string) =>
        this.handleStreamMessage(accumulated),
      onStreamEnd: (finalText: string, _hadStreamChunks: boolean) =>
        this.handleStreamEnd(finalText),
      onToolUse: (event: SessionExecutionEvent) => {
        const line = formatToolUse(event);
        if (line) this.adapter?.appendLine(line);
      },
      onError: (error: Error) => {
        this.inputBar?.setStatus(`${t(this.locale, "status.error.prefix")}${error.message}`, "error");
        this.inputBar?.setProcessing(false);
        this.inputBar?.setConnectionStatus("disconnected");
      },
    });
  }

  updateSettings(settings: PluginSettings): void {
    this.settings = settings;
    this.client.updateSettings(settings);
  }

  /**
   * 流式开始：如果 UI 可用，直接插入 header；否则仅记录有一条待写入的 assistant 消息
   */
  private handleStreamStart(): void {
    this.pendingAssistantText = "";
    this.pendingAssistantNotePath = this.notePath;
    if (this.adapter) {
      this.adapter.insertHeader();
    }
  }

  /**
   * 流式过程：UI 不在时仅更新缓冲，UI 在时正常写入 body
   */
  private handleStreamMessage(accumulated: string): void {
    this.pendingAssistantText = accumulated;
    if (this.adapter) {
      this.adapter.updateBody(accumulated);
    }
  }

  /**
   * 流式结束：UI 不在时把最终文本缓存在内存中，待视图恢复后补写到文档；
   * UI 在时正常 finalize。
   */
  private handleStreamEnd(finalText: string): void {
    this.pendingAssistantText = finalText;
    if (this.adapter) {
      this.adapter.finalizeBody(finalText);
      this.pendingAssistantText = null;
      this.pendingAssistantNotePath = null;
    }
    this.inputBar?.setStatus("");
    this.inputBar?.setProcessing(false);
    this.inputBar?.setConnectionStatus("connected");
  }

  /**
   * 将输入栏附加到 Markdown 视图。
   * channel_id 和 consumer_id 从笔记文件路径自动派生，每个笔记独立会话。
   */
  attachToMarkdownView(view: MarkdownView): void {
    const filePath = view.file?.path ?? "untitled";
    // 同一 MarkdownView 里切换文件时，view 引用可能不变；必须以 filePath 为准同步会话
    if (this.view === view && this.inputBar && this.notePath === filePath) return;

    this.detach();
    this.view = view;
    this.notePath = filePath;

    // per-note session key：obsidian:md5{notePath}
    this.client.setSessionKeyForNote(filePath);
    // channel_id / consumer_id 使用清洗后的 notePath，满足 [A-Za-z0-9_-]{1,128}
    const channelId = makeChannelId(filePath);
    const consumerId = `${channelId}_consumer`;
    this.client.setChannel(channelId, consumerId);

    this.adapter = new EditorAdapter(view);

    this.inputBar = new EditorInputBar(this.locale);
    this.inputBar.onSend = (text) => this.handleSend(text);
    this.inputBar.mount(view);
    this.inputBar.clearValue();
    this.inputBar.setStatus(t(this.locale, "status.ready"));

    // 如果在 UI 不可用期间已经收到了完整的 assistant 回复，且仍然是同一篇笔记，这里补写一次，避免漏消息
    if (this.pendingAssistantText != null && this.pendingAssistantNotePath === this.notePath) {
      this.adapter.insertHeader();
      this.adapter.finalizeBody(this.pendingAssistantText);
      this.pendingAssistantText = null;
      this.pendingAssistantNotePath = null;
    }

    // 异步检测 daemon 连接状态，完成前显示 checking
    this.client.checkHealth().then((ok) => {
      this.inputBar?.setConnectionStatus(ok ? "connected" : "disconnected");
    });
  }

  /**
   * 分离并清理当前视图的输入栏
   */
  detach(): void {
    this.adapter?.reset();
    this.adapter = null;
    this.inputBar?.destroy();
    this.inputBar = null;
    this.view = null;
    this.notePath = null;
    this.client.stop();
  }

  focus(): void {
    this.inputBar?.focus();
  }

  isAttached(): boolean {
    return this.inputBar !== null && this.view !== null;
  }

  getAttachedView(): MarkdownView | null {
    return this.view;
  }

  private async handleSend(text: string): Promise<void> {
    if (!this.view || !this.inputBar || !this.adapter) return;
    if (this.client.processing) return;
    if (!this.view.file) return;

    this.inputBar.clearValue();

    const message: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: "user",
      content: text,
      timestamp: Date.now(),
    };
    this.adapter.appendUserBlock(formatMessageBlock(message));

    this.inputBar.setStatus(t(this.locale, "status.processing"), "processing");
    this.inputBar.setProcessing(true);
    this.inputBar.setConnectionStatus("checking");

    try {
      await this.client.sendMessage(text);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.inputBar.setStatus(`发送失败: ${msg}`, "error");
      this.inputBar.setProcessing(false);
    }
  }
}
