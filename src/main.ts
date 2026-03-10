import { Plugin, PluginSettingTab, App, Setting, Notice, MarkdownView, WorkspaceLeaf } from "obsidian";
import type { PluginSettings } from "./types";
import { DEFAULT_PLUGIN_SETTINGS } from "./types";
import { EditorInputBar } from "./ui/EditorInputBar";
import { ChatUpdater } from "./markdown";

export default class AgentChatPlugin extends Plugin {
  settings: PluginSettings;
  inputBar: EditorInputBar;

  async onload(): Promise<void> {
    await this.loadSettings();

    // 创建编辑器输入栏实例
    this.inputBar = new EditorInputBar(this.app, this.settings);

    // 监听活动 leaf 变化，自动附加输入栏到 Markdown 视图
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        this.handleActiveLeafChange(leaf);
      })
    );

    // 初始检查当前活动视图
    this.app.workspace.onLayoutReady(() => {
      const activeLeaf = this.app.workspace.activeLeaf;
      if (activeLeaf) {
        this.handleActiveLeafChange(activeLeaf);
      }
    });

    // 命令：聚焦到输入栏（无默认快捷键，用户可在设置中自定义）
    this.addCommand({
      id: "focus-agent-input",
      name: "Focus agent input",
      callback: () => {
        if (this.inputBar.isAttached()) {
          this.inputBar.focus();
        } else {
          new Notice("请先打开一个 Markdown 文件");
        }
      },
    });

    // 命令：创建新的对话笔记
    this.addCommand({
      id: "create-chat-note",
      name: "Create new chat note",
      callback: () => this.createNewChatNote(),
    });

    // 设置页面
    this.addSettingTab(new AgentChatSettingTab(this.app, this));
  }

  onunload(): void {
    this.inputBar.detach();
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_PLUGIN_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.inputBar.updateSettings(this.settings);
  }

  /**
   * 处理活动 leaf 变化
   * 当切换到 Markdown 视图（非纯阅读模式）时，自动附加输入栏
   */
  private handleActiveLeafChange(leaf: WorkspaceLeaf | null): void {
    if (!leaf) {
      this.inputBar.detach();
      return;
    }

    const view = leaf.view;
    if (view instanceof MarkdownView) {
      // 只要是 Markdown 视图就附加（包括默认的编辑+预览分屏模式）
      this.inputBar.attachToMarkdownView(view);
    } else {
      // 离开 Markdown 视图时分离
      this.inputBar.detach();
    }
  }

  /**
   * 创建新的对话笔记
   */
  async createNewChatNote(): Promise<void> {
    const updater = new ChatUpdater(this.app);
    const title = `Chat ${new Date().toISOString().slice(0, 10)}`;
    const file = await updater.createChatNote(this.settings.defaultNoteFolder, title);

    // 在新标签页打开
    const leaf = this.app.workspace.getLeaf(true);
    await leaf.openFile(file);

    // 附加输入栏到 Markdown 视图
    if (leaf.view instanceof MarkdownView) {
      this.inputBar.attachToMarkdownView(leaf.view);
      this.inputBar.focus();
    }

    new Notice("已创建新对话笔记");
  }
}

class AgentChatSettingTab extends PluginSettingTab {
  plugin: AgentChatPlugin;

  constructor(app: App, plugin: AgentChatPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setHeading().setName("Agent Chat 设置");

    new Setting(containerEl)
      .setName("Daemon URL")
      .setDesc("duoduo daemon 的地址")
      .addText((text) =>
        text
          .setPlaceholder("http://127.0.0.1:20233")
          .setValue(this.plugin.settings.daemonUrl)
          .onChange(async (value) => {
            this.plugin.settings.daemonUrl = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Session Key")
      .setDesc("Agent 会话密钥（必填）")
      .addText((text) =>
        text
          .setPlaceholder("lark:oc_xxx:ou_xxx")
          .setValue(this.plugin.settings.sessionKey)
          .onChange(async (value) => {
            this.plugin.settings.sessionKey = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Source Kind")
      .setDesc("来源类型标识符")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.sourceKind)
          .onChange(async (value) => {
            this.plugin.settings.sourceKind = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Channel ID")
      .setDesc("频道标识符")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.channelId)
          .onChange(async (value) => {
            this.plugin.settings.channelId = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("默认笔记文件夹")
      .setDesc("对话笔记保存位置")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.defaultNoteFolder)
          .onChange(async (value) => {
            this.plugin.settings.defaultNoteFolder = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl).setHeading().setName("高级设置");

    new Setting(containerEl)
      .setName("Pull 间隔 (ms)")
      .setDesc("流式输出时两次拉取请求之间的间隔")
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.pullInterval))
          .onChange(async (value) => {
            const num = parseInt(value, 10);
            if (!isNaN(num)) {
              this.plugin.settings.pullInterval = num;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("Pull 等待 (ms)")
      .setDesc("daemon 长轮询等待时间")
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.pullWaitMs))
          .onChange(async (value) => {
            const num = parseInt(value, 10);
            if (!isNaN(num)) {
              this.plugin.settings.pullWaitMs = num;
              await this.plugin.saveSettings();
            }
          })
      );

    // 显示连接状态
    new Setting(containerEl).setHeading().setName("连接状态");
    const statusEl = containerEl.createDiv({ cls: "agent-connection-status" });
    this.checkConnection(statusEl);
  }

  private async checkConnection(container: HTMLElement): Promise<void> {
    container.setText("检查中...");
    try {
      const { requestUrl } = await import("obsidian");
      const response = await requestUrl({
        url: `${this.plugin.settings.daemonUrl}/healthz`,
        method: "GET",
        throw: false,
      });
      if (response.status === 200) {
        container.setText("✅ 已连接到 daemon");
        container.className = "agent-connection-status connected";
      } else {
        container.setText(`⚠️ Daemon 返回状态 ${response.status}`);
        container.className = "agent-connection-status warning";
      }
    } catch (error) {
      container.setText(`❌ 无法连接到 daemon (${this.plugin.settings.daemonUrl})`);
      container.className = "agent-connection-status error";
    }
  }
}
