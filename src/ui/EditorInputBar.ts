import { setIcon } from "obsidian";
import type { MarkdownView } from "obsidian";
import type { Locale } from "../i18n";
import { t } from "../i18n";

export type StatusType = "processing" | "error";
export type ConnectionStatus = "connected" | "disconnected" | "checking";

/**
 * 纯 UI 组件：渲染输入框、发送按钮、状态栏。
 * 不持有 AgentClient 或编辑器引用，所有业务逻辑通过回调传出。
 */
export class EditorInputBar {
  private containerEl: HTMLElement | null = null;
  private inputEl: HTMLTextAreaElement | null = null;
  private statusDotEl: HTMLElement | null = null;
  private statusTextEl: HTMLElement | null = null;
  private sendBtn: HTMLButtonElement | null = null;
  private isComposing = false;
  private locale: Locale;

  constructor(locale: Locale) {
    this.locale = locale;
  }

  /** 用户触发发送时调用，参数为输入框内容 */
  onSend: ((text: string) => void) | null = null;

  mount(view: MarkdownView): void {
    this.destroy();
    this.containerEl = view.containerEl.createDiv({ cls: "agent-editor-input-bar" });
    this.render();
    view.containerEl.appendChild(this.containerEl);
  }

  destroy(): void {
    this.containerEl?.remove();
    this.containerEl = null;
    this.inputEl = null;
    this.statusDotEl = null;
    this.statusTextEl = null;
    this.sendBtn = null;
  }

  /**
   * 更新连接状态指示点
   */
  setConnectionStatus(status: ConnectionStatus): void {
    if (!this.statusDotEl) return;
    this.statusDotEl.className = `agent-status-dot ${status}`;
    if (!this.statusDotEl.ariaLabel) {
      // 初次设置 ariaLabel，由控制层负责具体文字
      this.statusDotEl.ariaLabel = t(this.locale, "status.connection.checking");
    }
  }

  /**
   * 更新状态文字（idle 时传空字符串可隐藏文字）
   */
  setStatus(text: string, type?: StatusType): void {
    if (!this.statusTextEl) return;
    this.statusTextEl.textContent = text;
    this.statusTextEl.className = "agent-status-text";
    if (type) this.statusTextEl.addClass(type);
  }

  setProcessing(processing: boolean): void {
    if (!this.sendBtn) return;
    this.sendBtn.disabled = processing;
    this.sendBtn.toggleClass("processing", processing);
    if (this.statusDotEl) {
      this.statusDotEl.toggleClass("processing", processing);
    }
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
        placeholder: t(this.locale, "input.placeholder"),
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
        "aria-label": t(this.locale, "button.send.aria"),
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

    // 状态栏：左侧连接点 + 右侧状态文字
    const statusBar = this.containerEl.createDiv({ cls: "agent-editor-status" });
    this.statusDotEl = statusBar.createDiv({ cls: "agent-status-dot checking" });
    this.statusTextEl = statusBar.createDiv({ cls: "agent-status-text" });
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
