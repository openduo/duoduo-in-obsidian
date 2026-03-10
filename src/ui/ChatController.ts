import { MarkdownView, Notice } from "obsidian";
import type { OutboxRecord, SessionExecutionEvent } from "@openduo/protocol";
import type { PluginSettings, ChatMessage } from "../types";
import { AgentClient } from "../agent";
import { formatMessageBlock, formatToolUse } from "../markdown";
import { EditorInputBar } from "./EditorInputBar";
import { EditorAdapter } from "./EditorAdapter";

/**
 * 控制层：协调 EditorInputBar（UI）、EditorAdapter（编辑器）、AgentClient（通信）。
 * 持有会话状态，处理发送流程和 agent 响应路由。
 */
export class ChatController {
  private view: MarkdownView | null = null;
  private inputBar: EditorInputBar | null = null;
  private adapter: EditorAdapter | null = null;
  private client: AgentClient;
  private settings: PluginSettings;

  constructor(settings: PluginSettings) {
    this.settings = settings;
    this.client = new AgentClient(settings);

    this.client.setHandler({
      onStreamStart: () => {
        this.adapter?.insertHeader();
      },
      onMessage: (_record: OutboxRecord, accumulated: string) => {
        this.adapter?.updateBody(accumulated);
      },
      onStreamEnd: (finalText: string, _hadStreamChunks: boolean) => {
        this.adapter?.finalizeBody(finalText);
        this.inputBar?.setStatus("完成");
        this.inputBar?.setProcessing(false);
      },
      onToolUse: (event: SessionExecutionEvent) => {
        const line = formatToolUse(event);
        if (line) this.adapter?.appendLine(line);
      },
      onError: (error: Error) => {
        this.inputBar?.setStatus(`错误: ${error.message}`, "error");
        this.inputBar?.setProcessing(false);
      },
    });
  }

  updateSettings(settings: PluginSettings): void {
    this.settings = settings;
    this.client.updateSettings(settings);
  }

  /**
   * 将输入栏附加到 Markdown 视图
   */
  attachToMarkdownView(view: MarkdownView): void {
    if (this.view === view && this.inputBar) return;

    this.detach();
    this.view = view;

    this.adapter = new EditorAdapter(view);

    this.inputBar = new EditorInputBar();
    this.inputBar.onSend = (text) => this.handleSend(text);
    this.inputBar.mount(view);
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

    if (!this.settings.sessionKey) {
      new Notice("请先在设置中配置 Session Key");
      return;
    }

    if (!this.view.file) return;

    this.inputBar.clearValue();

    const message: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: "user",
      content: text,
      timestamp: Date.now(),
    };
    this.adapter.appendUserBlock(formatMessageBlock(message));

    this.inputBar.setStatus("处理中...", "processing");
    this.inputBar.setProcessing(true);

    try {
      await this.client.sendMessage(text);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.inputBar.setStatus(`发送失败: ${msg}`, "error");
      this.inputBar.setProcessing(false);
    }
  }
}
