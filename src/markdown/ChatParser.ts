import type { ChatMessage, ChatSession, MessageRole } from "../types";
import type { SessionExecutionEvent } from "@openduo/protocol";

const USER_BLOCKQUOTE_PATTERN = /^> \*\*You\*\*/;
const AGENT_ROLE_PATTERN = /^\*\*Agent\*\*/;
const TIMESTAMP_PATTERN = /·\s*(\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{2})/;

/**
 * 格式化时间戳为 MM/DD HH:mm 格式
 */
function formatTimestamp(date: Date): string {
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  return `${month}/${day} ${hours}:${minutes}`;
}

/**
 * 解析时间戳字符串
 */
function parseTimestamp(tsStr: string): number {
  // 格式: MM/DD HH:mm
  const match = tsStr.match(/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/);
  if (match) {
    const [, month, day, hours, minutes] = match.map(Number);
    const now = new Date();
    const year = now.getFullYear();
    const parsedDate = new Date(year, month - 1, day, hours, minutes);
    if (!isNaN(parsedDate.getTime())) {
      return parsedDate.getTime();
    }
  }
  return Date.now();
}

/**
 * 解析 blockquote 格式的用户消息
 * 格式：
 * > **You** · 10:05
 * >
 * > 消息内容
 */
function parseUserBlockquote(
  lines: string[],
  startIndex: number
): { message: ChatMessage; endIndex: number } | null {
  let i = startIndex;
  let timestamp = Date.now();
  let id = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // 解析角色和时间戳行：> **You** · 03/11 10:05
  const roleLine = lines[i];
  const tsMatch = roleLine.match(TIMESTAMP_PATTERN);
  if (tsMatch) {
    timestamp = parseTimestamp(tsMatch[1]);
  }
  i++;

  // 跳过空行（> 或 > ）
  while (i < lines.length && (lines[i] === ">" || lines[i].trim() === "")) {
    i++;
  }

  // 收集 blockquote 内容，直到遇到非 blockquote 行
  const content: string[] = [];
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("> ")) {
      content.push(line.slice(2)); // 移除 "> " 前缀
    } else if (line === ">") {
      content.push(""); // 空行
    } else if (line.trim() === "") {
      // 空行可能是 blockquote 的结束，也可能是 blockquote 内的空行
      // 检查下一行是否是 blockquote
      if (i + 1 < lines.length && !lines[i + 1].startsWith(">")) {
        break;
      }
      content.push("");
    } else {
      break;
    }
    i++;
  }

  if (content.length === 0) {
    return null;
  }

  return {
    message: {
      id,
      role: "user",
      content: content.join("\n").trim(),
      timestamp,
    },
    endIndex: i,
  };
}

/**
 * 解析 plain text 格式的 agent 消息
 * 格式：
 * **Agent** · 10:05
 *
 * 消息内容
 */
function parseAgentPlain(
  lines: string[],
  startIndex: number
): { message: ChatMessage; endIndex: number } | null {
  let i = startIndex;
  let timestamp = Date.now();
  let id = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // 解析角色和时间戳行：**Agent** · 03/11 10:05
  const roleLine = lines[i];
  const tsMatch = roleLine.match(TIMESTAMP_PATTERN);
  if (tsMatch) {
    timestamp = parseTimestamp(tsMatch[1]);
  }
  i++;

  // 跳过空行
  while (i < lines.length && lines[i].trim() === "") {
    i++;
  }

  // 收集内容，直到遇到下一个角色标记或 blockquote
  const content: string[] = [];
  while (i < lines.length) {
    const line = lines[i];
    // 遇到下一个角色标记，停止
    if (AGENT_ROLE_PATTERN.test(line) || USER_BLOCKQUOTE_PATTERN.test(line)) {
      break;
    }
    content.push(line);
    i++;
  }

  if (content.length === 0) {
    return null;
  }

  return {
    message: {
      id,
      role: "assistant",
      content: content.join("\n").trim(),
      timestamp,
    },
    endIndex: i,
  };
}

/**
 * 从 Markdown 内容解析聊天会话
 */
export function parseChatFromMarkdown(content: string): ChatSession {
  const lines = content.split("\n");
  const messages: ChatMessage[] = [];

  // 提取标题（第一个 H1）
  let title = "Agent Chat";
  const h1Match = content.match(/^# (.+)$/m);
  if (h1Match) {
    title = h1Match[1];
  }

  // 解析消息块
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 用户消息：blockquote 格式
    if (USER_BLOCKQUOTE_PATTERN.test(line)) {
      const result = parseUserBlockquote(lines, i);
      if (result) {
        messages.push(result.message);
        i = result.endIndex - 1;
      }
    }
    // Agent 消息：plain text 格式
    else if (AGENT_ROLE_PATTERN.test(line)) {
      const result = parseAgentPlain(lines, i);
      if (result) {
        messages.push(result.message);
        i = result.endIndex - 1;
      }
    }
  }

  const now = Date.now();
  return {
    id: `chat-${now}`,
    title,
    messages,
    createdAt: messages[0]?.timestamp ?? now,
    updatedAt: messages[messages.length - 1]?.timestamp ?? now,
  };
}

/**
 * 格式化消息块
 * 用户消息：blockquote 格式
 * Agent 消息：plain text 格式
 */
export function formatMessageBlock(message: ChatMessage): string {
  const timeStr = formatTimestamp(new Date(message.timestamp));

  if (message.role === "user") {
    // 用户消息：blockquote 格式
    const lines = message.content.split("\n");
    const quotedContent = lines.map((line) => `> ${line}`).join("\n");
    return `> **You** · ${timeStr}\n${quotedContent}`;
  } else {
    // Agent 消息：plain text 格式，标题和内容之间有空行
    return `**Agent** · ${timeStr}\n\n${message.content}`;
  }
}

/**
 * 格式化流式开始标记（只输出 header，body 留空供 append）
 */
export function formatStreamStart(role: MessageRole): string {
  const timeStr = formatTimestamp(new Date());

  if (role === "user") {
    return `> **You** · ${timeStr}\n> `;
  } else {
    return `**Agent** · ${timeStr}\n\n`;
  }
}

/**
 * 格式化 tool use 事件
 */
export function formatToolUse(event: SessionExecutionEvent): string {
  if (event.type === "tool_use") {
    const summary = event.input_summary || "";
    return `> *🔧 Using: ${event.tool_name}${summary ? ` — ${summary}` : ""}*`;
  } else if (event.type === "thought_chunk") {
    return `> *💭 ${event.text}*`;
  } else if (event.type === "tool_result") {
    const toolName = event.tool_name || "";
    const icon = event.is_error ? "❌" : "✓";
    return `> *${icon} ${toolName ? `${toolName}: ` : ""}${event.summary}*`;
  }
  return "";
}
