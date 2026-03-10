import { MarkdownView, setIcon } from "obsidian";

export type StatusType = "processing" | "error";

/**
 * 纯 UI 组件：渲染输入框、发送按钮、状态栏。
 * 不持有 AgentClient 或编辑器引用，所有业务逻辑通过回调传出。
 */
export class EditorInputBar {
  private containerEl: HTMLElement | null = null;
  private inputEl: HTMLTextAreaElement | null = null;
  private statusEl: HTMLElement | null = null;
  private sendBtn: HTMLButtonElement | null = null;
  private isComposing = false;

  /** 用户触发发送时调用，参数为输入框内容 */
  onSend: ((text: string) => void) | null = null;

  /**
   * 将输入栏渲染并挂载到指定 Markdown 视图底部
   */
  mount(view: MarkdownView): void {
    this.destroy();
    this.containerEl = view.containerEl.createDiv({ cls: "agent-editor-input-bar" });
    this.render();
    view.containerEl.appendChild(this.containerEl);
  }

  /**
   * 从 DOM 移除并清理
   */
  destroy(): void {
    this.containerEl?.remove();
    this.containerEl = null;
    this.inputEl = null;
    this.statusEl = null;
    this.sendBtn = null;
  }

  setStatus(text: string, type?: StatusType): void {
    if (!this.statusEl) return;
    this.statusEl.textContent = text;
    this.statusEl.className = "agent-editor-status";
    if (type) this.statusEl.addClass(type);
  }

  setProcessing(processing: boolean): void {
    if (!this.sendBtn) return;
    this.sendBtn.disabled = processing;
    this.sendBtn.toggleClass("processing", processing);
  }

  focus(): void {
    this.inputEl?.focus();
  }

  getValue(): string {
    return this.inputEl?.value.trim() ?? "";
  }

  clearValue(): void {
    if (!this.inputEl) return;
    this.inputEl.value = "";
    this.autoResize();
  }

  private render(): void {
    if (!this.containerEl) return;
    this.containerEl.empty();

    const inputWrapper = this.containerEl.createDiv({ cls: "agent-input-wrapper" });

    this.inputEl = inputWrapper.createEl("textarea", {
      cls: "agent-editor-input",
      attr: {
        placeholder: "与 Agent 对话... (Enter 发送, Shift+Enter 换行)",
        rows: "1",
      },
    });

    this.inputEl.addEventListener("input", () => this.autoResize());

    // IME 组合状态跟踪，防止中文输入法 Enter 误触发发送
    this.inputEl.addEventListener("compositionstart", () => {
      this.isComposing = true;
    });
    this.inputEl.addEventListener("compositionend", () => {
      this.isComposing = false;
    });

    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !this.isComposing) {
        e.preventDefault();
        this.triggerSend();
      }
    });

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

    this.sendBtn.addEventListener("click", () => this.triggerSend());
    this.sendBtn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        this.triggerSend();
      }
    });

    this.statusEl = this.containerEl.createDiv({ cls: "agent-editor-status" });
    this.setStatus("就绪");
  }

  private triggerSend(): void {
    const text = this.getValue();
    if (text) this.onSend?.(text);
  }

  private autoResize(): void {
    if (!this.inputEl) return;
    this.inputEl.style.height = "auto";
    this.inputEl.style.height = Math.min(this.inputEl.scrollHeight, 150) + "px";
  }
}
