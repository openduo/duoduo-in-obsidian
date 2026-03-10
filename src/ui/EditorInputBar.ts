import { App, Editor, MarkdownView, Notice, setIcon } from "obsidian";
import type { PluginSettings } from "../types";
import type { OutboxRecord, SessionExecutionEvent } from "@openduo/protocol";
import { AgentClient } from "../agent";
import { ChatUpdater, formatStreamStart, formatMessageBlock, formatToolUse } from "../markdown";
import type { ChatMessage } from "../types";

/**
 * 编辑器底部常驻输入栏
 * 用户在当前 markdown 文件中与 agent 对话，回复直接以 callout 形式写入文件
 */
export class EditorInputBar {
  private containerEl: HTMLElement | null = null;
  private inputEl: HTMLTextAreaElement | null = null;
  private statusEl: HTMLElement | null = null;
  private sendBtn: HTMLButtonElement | null = null;
  private client: AgentClient;
  private updater: ChatUpdater;
  private settings: PluginSettings;
  private app: App;
  private streamingBodyLine: number = -1; // 流式消息 body 开始的行号（append-only 起始位置）
  private attachedView: MarkdownView | null = null;

  constructor(app: App, settings: PluginSettings) {
    this.app = app;
    this.settings = settings;
    this.client = new AgentClient(settings);
    this.updater = new ChatUpdater(app);

    this.client.setHandler({
      onMessage: (record: OutboxRecord, accumulated: string) => {
        this.updateStreamingCallout(accumulated);
      },
      onStreamStart: () => {
        this.insertStreamingCallout();
      },
      onStreamEnd: (finalText: string) => {
        this.finalizeStreamingCallout(finalText);
      },
      onToolUse: (event: SessionExecutionEvent) => {
        this.handleToolUse(event);
      },
      onError: (error: Error) => {
        this.setStatus(`错误: ${error.message}`, "error");
        this.updateSendButton(false);
      },
    });
  }

  updateSettings(settings: PluginSettings): void {
    this.settings = settings;
    this.client.updateSettings(settings);
  }

  /**
   * 将输入栏附加到 Markdown 视图
   * 输入栏会附加到视图容器的底部，在编辑和默认模式下都可见
   */
  attachToMarkdownView(view: MarkdownView): void {
    // 如果已经附加到同一个视图，不做任何事
    if (this.attachedView === view && this.containerEl) {
      return;
    }

    // 先从旧视图分离
    this.detach();

    this.attachedView = view;

    // 创建输入栏容器（使用 Obsidian DOM helper）
    this.containerEl = view.containerEl.createDiv({ cls: "agent-editor-input-bar" });
    this.render();

    // 附加到视图容器底部（而不是编辑器容器内部）
    view.containerEl.appendChild(this.containerEl);
  }

  /**
   * 从当前视图分离
   */
  detach(): void {
    if (this.containerEl) {
      this.containerEl.remove();
      this.containerEl = null;
    }
    this.attachedView = null;
    this.streamingBodyLine = -1; // 重置 streaming 状态
    this.client.stop();
  }

  private render(): void {
    if (!this.containerEl) return;

    this.containerEl.empty();

    // 输入区域
    const inputWrapper = this.containerEl.createDiv({ cls: "agent-input-wrapper" });

    this.inputEl = inputWrapper.createEl("textarea", {
      cls: "agent-editor-input",
      attr: {
        placeholder: "与 Agent 对话... (Enter 发送, Shift+Enter 换行)",
        rows: "1",
      },
    });

    // 自动调整高度
    this.inputEl.addEventListener("input", () => {
      this.autoResize();
    });

    // 快捷键
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.handleSend();
      }
    });

    // 按钮区域
    const btnWrapper = inputWrapper.createDiv({ cls: "agent-btn-wrapper" });

    this.sendBtn = btnWrapper.createEl("button", {
      cls: "agent-send-btn",
      attr: {
        type: "button",
        "aria-label": "发送消息",
        "data-tooltip-position": "top",
      },
    });
    setIcon(this.sendBtn, "send");
    this.sendBtn.addEventListener("click", () => this.handleSend());
    
    // 键盘无障碍：Enter 和 Space 键触发发送
    this.sendBtn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        this.handleSend();
      }
    });

    // 状态栏
    this.statusEl = this.containerEl.createDiv({ cls: "agent-editor-status" });
    this.setStatus("就绪");
  }

  private autoResize(): void {
    if (!this.inputEl) return;
    this.inputEl.style.height = "auto";
    this.inputEl.style.height = Math.min(this.inputEl.scrollHeight, 150) + "px";
  }

  private setStatus(text: string, type?: "processing" | "error"): void {
    if (!this.statusEl) return;
    this.statusEl.textContent = text;
    this.statusEl.className = "agent-editor-status";
    if (type) {
      this.statusEl.addClass(type);
    }
  }

  private updateSendButton(isProcessing: boolean): void {
    if (!this.sendBtn) return;
    this.sendBtn.disabled = isProcessing;
    this.sendBtn.toggleClass("processing", isProcessing);
  }

  private async handleSend(): Promise<void> {
    if (!this.inputEl || !this.attachedView) return;

    const text = this.inputEl.value.trim();
    if (!text || this.client.processing) return;

    if (!this.settings.sessionKey) {
      new Notice("请先在设置中配置 Session Key");
      return;
    }

    const editor = this.attachedView.editor;
    const file = this.attachedView.file;
    if (!editor || !file) return;

    // 清空输入框
    this.inputEl.value = "";
    this.autoResize();

    // 在编辑器末尾插入用户消息块（HR 格式）
    const userBlock = this.formatUserBlock(text);
    const content = editor.getValue();
    const prefix = content.length > 0 && !content.endsWith("\n\n") ? "\n\n" : "";
    editor.replaceRange(prefix + userBlock + "\n\n", { line: editor.lineCount(), ch: 0 });

    // 发送到 agent
    this.setStatus("处理中...", "processing");
    this.updateSendButton(true);

    try {
      await this.client.sendMessage(text);
    } catch (error) {
      this.setStatus(`发送失败: ${error instanceof Error ? error.message : String(error)}`, "error");
      this.updateSendButton(false);
    }
  }

  private formatUserBlock(text: string): string {
    const message: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: "user",
      content: text,
      timestamp: Date.now(),
    };
    return formatMessageBlock(message);
  }

  private insertStreamingCallout(): void {
    if (!this.attachedView) return;
    const editor = this.attachedView.editor;

    // 插入 agent header（只包含角色行和空行，body 留空）
    // header 格式：**Agent** · HH:mm\n\n（共 2 行）
    const header = formatStreamStart("assistant");
    const pos = { line: editor.lineCount(), ch: 0 };
    editor.replaceRange(header, pos);
    
    // 记录 body 开始的行号（header 后最后一个空行之后）
    // header 插入后，lineCount() 增加了 2 行
    // body 应该从最后一个空行之后开始，也就是 lineCount() - 1
    this.streamingBodyLine = editor.lineCount() - 1;
  }

  private updateStreamingCallout(text: string): void {
    if (!this.attachedView || this.streamingBodyLine < 0) return;
    const editor = this.attachedView.editor;

    // Append-only 更新：直接替换从 streamingBodyLine 到文件末尾的内容
    const currentLineCount = editor.lineCount();
    
    // 构建新的 body 内容（追加光标符表示正在输入）
    const newBody = text + "▋";
    
    // 确定替换范围：从 streamingBodyLine 到文件末尾
    const startPos = { line: this.streamingBodyLine, ch: 0 };
    const endPos = { line: currentLineCount - 1, ch: editor.getLine(currentLineCount - 1).length };
    
    editor.replaceRange(newBody, startPos, endPos);
  }

  private finalizeStreamingCallout(text: string): void {
    if (!this.attachedView || this.streamingBodyLine < 0) return;
    const editor = this.attachedView.editor;

    // 移除光标符，写入最终内容
    const currentLineCount = editor.lineCount();
    const startPos = { line: this.streamingBodyLine, ch: 0 };
    const endPos = { line: currentLineCount - 1, ch: editor.getLine(currentLineCount - 1).length };
    
    // 替换为最终内容（移除光标符）
    editor.replaceRange(text, startPos, endPos);
    
    // 重置状态
    this.streamingBodyLine = -1;
    this.setStatus("完成");
    this.updateSendButton(false);
  }

  /**
   * 处理 tool use 事件，追加到编辑器
   */
  private handleToolUse(event: SessionExecutionEvent): void {
    if (!this.attachedView) return;
    const editor = this.attachedView.editor;

    const toolUseLine = formatToolUse(event);
    if (!toolUseLine) return;

    // 在文件末尾追加 tool use 行
    const content = editor.getValue();
    const prefix = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
    editor.replaceRange(prefix + toolUseLine + "\n", { line: editor.lineCount(), ch: 0 });
  }

  /**
   * 获取当前附加到的视图
   */
  getAttachedView(): MarkdownView | null {
    return this.attachedView;
  }

  /**
   * 输入栏是否已附加到某个视图
   */
  isAttached(): boolean {
    return this.containerEl !== null && this.attachedView !== null;
  }

  /**
   * 聚焦到输入框
   */
  focus(): void {
    this.inputEl?.focus();
  }
}
