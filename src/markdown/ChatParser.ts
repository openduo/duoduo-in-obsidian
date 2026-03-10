import type { ChatMessage, ChatSession, MessageRole } from "../types";

const HR_SEPARATOR = "---";
const USER_ROLE_PATTERN = /^\*\*You\*\*/;
const AGENT_ROLE_PATTERN = /^\*\*Agent\*\*/;
const TIMESTAMP_PATTERN = /·\s*(\d{1,2}:\d{2})/;

/**
 * 解析单个消息块（HR 分隔格式）
 * 格式：
 * ---
 * **You** · 10:05
 *
 * 消息内容
 */
function parseMessageBlock(
  lines: string[],
  startIndex: number,
  role: MessageRole
): { message: ChatMessage; endIndex: number } | null {
  let i = startIndex + 1; // 跳过 HR 分隔线
  let timestamp = Date.now();
  let id = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // 解析角色和时间戳行：**You** · 10:05 或 **Agent** · 10:05
  if (i < lines.length) {
    const roleLine = lines[i];
    const roleMatch = role === "user" 
      ? roleLine.match(USER_ROLE_PATTERN)
      : roleLine.match(AGENT_ROLE_PATTERN);
    
    if (roleMatch) {
      const tsMatch = roleLine.match(TIMESTAMP_PATTERN);
      if (tsMatch) {
        // 解析时间戳（简化：只提取 HH:mm，使用当前日期）
        const [hours, minutes] = tsMatch[1].split(":").map(Number);
        const now = new Date();
        const parsedDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes);
        if (!isNaN(parsedDate.getTime())) {
          timestamp = parsedDate.getTime();
        }
      }
      i++;
    }
  }

  // 跳过空行
  while (i < lines.length && lines[i].trim() === "") {
    i++;
  }

  // 收集消息内容，直到下一个 HR 分隔线或文件结束
  const content: string[] = [];
  while (i < lines.length) {
    const line = lines[i];
    if (line === HR_SEPARATOR) {
      // 遇到下一个分隔线，停止
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
      role,
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

  // 解析消息块（HR 分隔格式）
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line === HR_SEPARATOR) {
      // 检查下一行是否是角色标记
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1];
        let role: MessageRole | null = null;

        if (USER_ROLE_PATTERN.test(nextLine)) {
          role = "user";
        } else if (AGENT_ROLE_PATTERN.test(nextLine)) {
          role = "assistant";
        }

        if (role) {
          const result = parseMessageBlock(lines, i, role);
          if (result) {
            messages.push(result.message);
            i = result.endIndex - 1;
          }
        }
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
 * 格式化消息为 HR+加粗角色格式
 */
export function formatMessageBlock(message: ChatMessage): string {
  const roleLabel = message.role === "user" ? "You" : "Agent";
  const timestamp = new Date(message.timestamp);
  const timeStr = `${timestamp.getHours().toString().padStart(2, "0")}:${timestamp.getMinutes().toString().padStart(2, "0")}`;
  
  return `---\n**${roleLabel}** · ${timeStr}\n\n${message.content}`;
}

/**
 * 格式化流式开始标记（只输出 header，body 留空供 append）
 */
export function formatStreamStart(role: MessageRole): string {
  const roleLabel = role === "user" ? "You" : "Agent";
  const timestamp = new Date();
  const timeStr = `${timestamp.getHours().toString().padStart(2, "0")}:${timestamp.getMinutes().toString().padStart(2, "0")}`;
  
  return `---\n**${roleLabel}** · ${timeStr}\n\n`;
}

// 向后兼容：保留旧函数名，但使用新实现
export const formatMessageAsCallout = formatMessageBlock;
