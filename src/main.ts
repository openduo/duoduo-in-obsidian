import { Plugin, PluginSettingTab, App, Setting, Notice, MarkdownView, WorkspaceLeaf, requestUrl } from "obsidian";
import type { PluginSettings } from "./types";
import { DEFAULT_PLUGIN_SETTINGS } from "./types";
import { ChatController } from "./ui/ChatController";
import { ChatUpdater } from "./markdown";
import type { Locale } from "./i18n";
import { detectLocale, t } from "./i18n";

export default class AgentChatPlugin extends Plugin {
  settings: PluginSettings;
  controller: ChatController;
  locale: Locale;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.locale = detectLocale(this.app);
    this.controller = new ChatController(this.settings, this.locale);

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
      name: t(this.locale, "cmd.focus"),
      callback: () => {
        if (this.controller.isAttached()) {
          this.controller.focus();
        } else {
          new Notice("请先打开一个 Markdown 文件");
        }
      },
    });

    // 命令：创建新的对话笔记
    this.addCommand({
      id: "create-chat-note",
      name: t(this.locale, "cmd.create-note"),
      callback: () => this.createNewChatNote(),
    });

    // 设置页面
    this.addSettingTab(new AgentChatSettingTab(this.app, this));
  }

  onunload(): void {
    this.controller.detach();
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_PLUGIN_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.controller.updateSettings(this.settings);
  }

  /**
   * 处理活动 leaf 变化
   * 当切换到 Markdown 视图（非纯阅读模式）时，自动附加输入栏
   */
  private handleActiveLeafChange(leaf: WorkspaceLeaf | null): void {
    if (!leaf) {
      this.controller.detach();
      return;
    }

    const view = leaf.view;
    if (view instanceof MarkdownView) {
      this.controller.attachToMarkdownView(view);
    } else {
      this.controller.detach();
    }
  }

  /**
   * 创建新的对话笔记
   */
  async createNewChatNote(): Promise<void> {
    const updater = new ChatUpdater(this.app);
    const title = `Chat ${new Date().toISOString().slice(0, 10)}`;
    const file = await updater.createChatNote(this.settings.defaultNoteFolder, title);

    const leaf = this.app.workspace.getLeaf(true);
    await leaf.openFile(file);

    if (leaf.view instanceof MarkdownView) {
      this.controller.attachToMarkdownView(leaf.view);
      this.controller.focus();
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

    const locale = detectLocale(this.app);

    new Setting(containerEl).setHeading().setName(t(locale, "settings.section.main"));

    new Setting(containerEl)
      .setName(t(locale, "settings.daemon-url"))
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
      .setName(t(locale, "settings.source-kind"))
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
      .setName(t(locale, "settings.default-folder"))
      .setDesc("对话笔记保存位置")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.defaultNoteFolder)
          .onChange(async (value) => {
            this.plugin.settings.defaultNoteFolder = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl).setHeading().setName(t(locale, "settings.section.advanced"));

    new Setting(containerEl)
      .setName(t(locale, "settings.pull-interval"))
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
      .setName(t(locale, "settings.pull-wait"))
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
    new Setting(containerEl).setHeading().setName(t(locale, "settings.connection.section"));
    const statusEl = containerEl.createDiv({ cls: "agent-connection-status" });
    this.checkConnection(statusEl);
  }

  private async checkConnection(container: HTMLElement): Promise<void> {
    const locale = detectLocale(this.app);
    container.setText(t(locale, "status.connection.checking"));
    try {
      const response = await requestUrl({
        url: `${this.plugin.settings.daemonUrl}/healthz`,
        method: "GET",
        throw: false,
      });
      if (response.status === 200) {
        container.setText("✅ " + t(locale, "status.connection.connected"));
        container.className = "agent-connection-status connected";
      } else {
        container.setText(`⚠️ Daemon 返回状态 ${response.status}`);
        container.className = "agent-connection-status warning";
      }
    } catch {
      container.setText(`❌ ${t(locale, "status.connection.disconnected")} (${this.plugin.settings.daemonUrl})`);
      container.className = "agent-connection-status error";
    }
  }
}
