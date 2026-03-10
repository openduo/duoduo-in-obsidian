import type { ChatMessage } from "../types";
import { formatMessageBlock } from "./ChatParser";
import { App, TFile, normalizePath } from "obsidian";

export class ChatUpdater {
  constructor(private app: App) {}

  async appendMessage(file: TFile, message: ChatMessage): Promise<void> {
    const block = formatMessageBlock(message);
    await this.app.vault.process(file, (content) => {
      return content.trimEnd() + "\n\n" + block + "\n";
    });
  }

  async updateMessage(
    file: TFile,
    messageId: string,
    newContent: string
  ): Promise<void> {
    // 注意：此方法目前用于更新消息，但新格式（HR）下 streaming 直接在 EditorInputBar 中处理
    // 保留此方法以保持 API 兼容性，但实现可能需要根据新格式调整
    await this.app.vault.process(file, (content) => {
      // TODO: 如果需要支持更新消息，需要根据新格式（HR+角色标记）实现解析和替换逻辑
      // 目前 streaming 更新直接在编辑器中完成，此方法可能不再需要
      return content;
    });
  }

  async createChatNote(
    folder: string,
    title: string,
    firstMessage?: ChatMessage
  ): Promise<TFile> {
    const folderPath = normalizePath(folder);
    
    // Ensure folder exists
    if (!this.app.vault.getAbstractFileByPath(folderPath)) {
      await this.app.vault.createFolder(folderPath);
    }

    const fileName = `${title.replace(/[/\\?%*:|"<>]/g, "-")}.md`;
    const filePath = normalizePath(`${folderPath}/${fileName}`);

    let content = `# ${title}\n\n`;
    if (firstMessage) {
      content += formatMessageBlock(firstMessage) + "\n";
    }

    const file = await this.app.vault.create(filePath, content);
    return file as TFile;
  }

  async getOrCreateTodayNote(folder: string): Promise<TFile> {
    const today = new Date().toISOString().split("T")[0];
    const title = `Agent Chat ${today}`;
    const filePath = normalizePath(`${folder}/${title}.md`);

    const existing = this.app.vault.getAbstractFileByPath(filePath);
    if (existing && existing instanceof TFile) {
      return existing;
    }

    return this.createChatNote(folder, title);
  }
}
