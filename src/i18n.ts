import type { App } from "obsidian";

export type Locale = "en" | "zh-CN";

const MESSAGES: Record<Locale, Record<string, string>> = {
  en: {
    "cmd.focus": "Focus agent input",
    "cmd.create-note": "Create new chat note",

    "input.placeholder": "Talk to Agent... (Enter to send, Shift+Enter for newline)",
    "button.send.aria": "Send message",

    "status.ready": "Ready",
    "status.processing": "Processing...",
    "status.error.prefix": "Error: ",

    "status.connection.checking": "Checking connection...",
    "status.connection.connected": "Daemon connected",
    "status.connection.disconnected": "Daemon disconnected",

    "settings.section.main": "Agent Chat Settings",
    "settings.daemon-url": "Daemon URL",
    "settings.source-kind": "Source Kind",
    "settings.default-folder": "Default note folder",
    "settings.section.advanced": "Advanced settings",
    "settings.pull-interval": "Pull interval (ms)",
    "settings.pull-wait": "Pull wait (ms)",
    "settings.connection.section": "Connection status",
  },
  "zh-CN": {
    "cmd.focus": "聚焦到输入栏",
    "cmd.create-note": "创建新的对话笔记",

    "input.placeholder": "与 Agent 对话... (Enter 发送, Shift+Enter 换行)",
    "button.send.aria": "发送消息",

    "status.ready": "就绪",
    "status.processing": "处理中...",
    "status.error.prefix": "错误: ",

    "status.connection.checking": "检查中...",
    "status.connection.connected": "已连接到 daemon",
    "status.connection.disconnected": "无法连接到 daemon",

    "settings.section.main": "Agent Chat 设置",
    "settings.daemon-url": "Daemon URL",
    "settings.source-kind": "Source Kind",
    "settings.default-folder": "默认笔记文件夹",
    "settings.section.advanced": "高级设置",
    "settings.pull-interval": "Pull 间隔 (ms)",
    "settings.pull-wait": "Pull 等待 (ms)",
    "settings.connection.section": "连接状态",
  },
};

export function detectLocale(app: App): Locale {
  const raw = (app as any).vault?.getConfig?.("locale") as string | undefined;
  if (raw && raw.toLowerCase().startsWith("zh")) return "zh-CN";
  return "en";
}

export function t(locale: Locale, key: string): string {
  const table = MESSAGES[locale] ?? MESSAGES.en;
  return table[key] ?? MESSAGES.en[key] ?? key;
}

