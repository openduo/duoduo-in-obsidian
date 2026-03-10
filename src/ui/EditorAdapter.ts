import { MarkdownView } from "obsidian";
import { formatStreamStart } from "../markdown";

/**
 * 封装对 MarkdownView.editor 的所有写入操作。
 * 管理流式输出状态（streamingBodyLine、节流渲染），不感知 UI 和网络层。
 */
export class EditorAdapter {
  private streamingBodyLine = -1;
  private pendingText: string | null = null;
  private rafId: number | null = null;

  constructor(private view: MarkdownView) {}

  /**
   * 在文件末尾插入 agent 消息 header，并记录 body 起始行
   */
  insertHeader(): void {
    const editor = this.view.editor;
    const header = formatStreamStart("assistant");
    editor.replaceRange(header, { line: editor.lineCount(), ch: 0 });
    // header 占 2 行（角色行 + 空行），body 从最后一行开始
    this.streamingBodyLine = editor.lineCount() - 1;
  }

  /**
   * 节流更新 body 区域（每帧最多渲染一次），附带光标符提示流式进行中
   */
  updateBody(text: string): void {
    if (this.streamingBodyLine < 0) return;
    this.pendingText = text;
    if (this.rafId !== null) return;
    this.rafId = window.requestAnimationFrame(() => {
      this.rafId = null;
      const latest = this.pendingText;
      this.pendingText = null;
      if (latest === null || this.streamingBodyLine < 0) return;
      this.writeBodyText(latest + "▋");
    });
  }

  /**
   * 写入最终内容，取消节流渲染，重置状态
   */
  finalizeBody(text: string): void {
    if (this.rafId !== null) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.pendingText = null;
    if (this.streamingBodyLine < 0) return;
    this.writeBodyText(text);
    this.streamingBodyLine = -1;
  }

  /**
   * 在文件末尾写入用户消息块（含前置空行保证格式正确）
   */
  appendUserBlock(block: string): void {
    const editor = this.view.editor;
    const content = editor.getValue();
    const prefix = content.length > 0 && !content.endsWith("\n\n") ? "\n\n" : "";
    editor.replaceRange(prefix + block + "\n\n", { line: editor.lineCount(), ch: 0 });
  }

  /**
   * 在文件末尾追加一行（用于 tool use 事件等）
   */
  appendLine(line: string): void {
    const editor = this.view.editor;
    const content = editor.getValue();
    const prefix = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
    editor.replaceRange(prefix + line + "\n", { line: editor.lineCount(), ch: 0 });
  }

  /**
   * 取消所有进行中的渲染（视图切换或插件卸载时调用）
   */
  reset(): void {
    if (this.rafId !== null) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.pendingText = null;
    this.streamingBodyLine = -1;
  }

  get isStreaming(): boolean {
    return this.streamingBodyLine >= 0;
  }

  private writeBodyText(text: string): void {
    if (this.streamingBodyLine < 0) return;
    const editor = this.view.editor;
    const lineCount = editor.lineCount();
    const startPos = { line: this.streamingBodyLine, ch: 0 };
    const endPos = { line: lineCount - 1, ch: editor.getLine(lineCount - 1).length };
    editor.replaceRange(text, startPos, endPos);
  }
}
