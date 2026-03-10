// Chat domain types

export type MessageRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  isStreaming?: boolean;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface AgentSettings {
  daemonUrl: string;
  sessionKey: string;
  sourceKind: string;
  channelId: string;
  consumerId: string;
  pullInterval: number;
  pullWaitMs: number;
}

export const DEFAULT_SETTINGS: AgentSettings = {
  daemonUrl: "http://127.0.0.1:20233",
  sessionKey: "",
  sourceKind: "obsidian",
  channelId: "obsidian-local",
  consumerId: "obsidian-consumer",
  pullInterval: 500,
  pullWaitMs: 5000,
};

export interface PluginSettings extends AgentSettings {
  defaultNoteFolder: string;
  autoCreateNote: boolean;
}

export const DEFAULT_PLUGIN_SETTINGS: PluginSettings = {
  ...DEFAULT_SETTINGS,
  defaultNoteFolder: "Agent Chats",
  autoCreateNote: true,
};
