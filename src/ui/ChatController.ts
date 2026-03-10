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
  private inputBar: EditorInputBar | null = null;
  private adapter: EditorAdapter | null = null;
  private client: AgentClient;
  private settings: PluginSettings;
  private locale: Locale;

  constructor(settings: PluginSettings, locale: Locale) {
    this.settings = settings;
    this.locale = locale;
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
        this.inputBar?.setStatus("");
        this.inputBar?.setProcessing(false);
        this.inputBar?.setConnectionStatus("connected");
      },
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
   * 将输入栏附加到 Markdown 视图。
   * channel_id 和 consumer_id 从笔记文件路径自动派生，每个笔记独立会话。
   */
  attachToMarkdownView(view: MarkdownView): void {
    if (this.view === view && this.inputBar) return;

    this.detach();
    this.view = view;

    const filePath = view.file?.path ?? "untitled";
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
    this.inputBar.setStatus(t(this.locale, "status.ready"));

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
