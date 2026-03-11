import { MarkdownView } from "obsidian";
import { formatStreamStart } from "../markdown";
import { EditorView } from "@codemirror/view";

/**
 * 封装对 MarkdownView.editor 的所有写入操作。
 * 管理流式输出状态（streamingBodyLine、节流渲染），不感知 UI 和网络层。
 *
 * 通过 view.editor.cm 直接访问 CodeMirror 6 EditorView，
 * 使用 scrollSnapshot() effect 来保持滚动位置。
 */
export class EditorAdapter {
  private streamingBodyLine = -1;
  private pendingText: string | null = null;
  private rafId: number | null = null;
  /** 记录用户是否正在查看历史内容（滚动不在底部） */
  private userScrolledUp = false;
  /** 滚动检测的阈值（距底部多少像素内视为"在底部"） */
  private readonly scrollThreshold = 50;

  constructor(private view: MarkdownView) {
    this.initScroller();
  }

  /**
   * 获取 CodeMirror 6 EditorView 实例
   */
  private get cm(): EditorView {
    // @ts-expect-error - Obsidian 未在类型定义中暴露 cm 属性
    return this.view.editor.cm as EditorView;
  }

  /**
   * 初始化 scroller 引用和滚动监听
   */
  private initScroller(): void {
    const tryGetScroller = () => {
      const scroller = this.view.containerEl.querySelector(".cm-scroller") as HTMLElement | null;
      if (scroller) {
        scroller.addEventListener("scroll", () => {
          const atBottom =
            scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < this.scrollThreshold;
          this.userScrolledUp = !atBottom;
        });
      } else {
        setTimeout(tryGetScroller, 100);
      }
    };
    tryGetScroller();
  }

  /**
   * 滚动到文档底部
   */
  private scrollToBottom(): void {
    setTimeout(() => {
      const lastLine = this.cm.state.doc.line(this.cm.state.doc.lines);
      this.cm.dispatch({
        effects: EditorView.scrollIntoView(lastLine.to),
      });
    }, 0);
  }

  /**
   * 在文件末尾插入 agent 消息 header，并记录 body 起始行
   */
  insertHeader(): void {
    const cm = this.cm;
    const doc = cm.state.doc;
    const header = formatStreamStart("assistant");

    cm.dispatch(
      cm.state.update({
        changes: { from: doc.length, insert: header },
      })
    );

    // header 占 2 行（角色行 + 空行），body 从最后一行开始
    this.streamingBodyLine = cm.state.doc.lines - 1;
    this.scrollToBottom();
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
    this.userScrolledUp = false;

    const cm = this.cm;
    const doc = cm.state.doc;
    const content = doc.toString();
    const prefix = content.length > 0 && !content.endsWith("\n\n") ? "\n\n" : "";

    cm.dispatch(
      cm.state.update({
        changes: { from: doc.length, insert: prefix + block + "\n\n" },
      })
    );

    this.scrollToBottom();
  }

  /**
   * 在文件末尾追加一行（用于 tool use 事件等）
   */
  appendLine(line: string): void {
    const cm = this.cm;
    const doc = cm.state.doc;
    const content = doc.toString();
    const prefix = content.length > 0 && !content.endsWith("\n") ? "\n" : "";

    if (!this.userScrolledUp) {
      cm.dispatch(
        cm.state.update({
          changes: { from: doc.length, insert: prefix + line + "\n" },
        })
      );
      this.scrollToBottom();
    } else {
      const snapshot = cm.scrollSnapshot();
      cm.dispatch(
        cm.state.update({
          changes: { from: doc.length, insert: prefix + line + "\n" },
        })
      );
      cm.dispatch({ effects: snapshot });
    }
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
    this.userScrolledUp = false;
  }

  get isStreaming(): boolean {
    return this.streamingBodyLine >= 0;
  }

  private writeBodyText(text: string): void {
    if (this.streamingBodyLine < 0) return;

    const cm = this.cm;
    const doc = cm.state.doc;
    const startLine = doc.line(this.streamingBodyLine + 1); // CM6 line 是 1-indexed
    const endLine = doc.line(doc.lines);

    if (!this.userScrolledUp) {
      cm.dispatch(
        cm.state.update({
          changes: { from: startLine.from, to: endLine.to, insert: text },
        })
      );
      this.scrollToBottom();
    } else {
      const snapshot = cm.scrollSnapshot();
      cm.dispatch(
        cm.state.update({
          changes: { from: startLine.from, to: endLine.to, insert: text },
        })
      );
      cm.dispatch({ effects: snapshot });
    }
  }
}
