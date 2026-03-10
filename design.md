# obsidian-agent-chat 插件

让 Obsidian 成为 Agent 的原生对话界面。

## 设计意图

对话直接以 Markdown callout 形式写入笔记文件，而不是在独立的侧边栏 UI 中。

## 架构

```
┌─────────────────────────────────────┐
│  Obsidian Markdown 视图             │
│                                     │
│  # 我的笔记                          │
│                                     │
│  > [!agent-user]                    │
│  > *2026-03-10T03:05:00Z*           │
│  > 你好，帮我写个函数                │
│                                     │
│  > [!agent]                         │
│  > *2026-03-10T03:05:02Z*           │
│  > 好的，这是一个示例...             │
│                                     │
├─────────────────────────────────────┤
│  [常驻输入栏: 与 Agent 对话...] [➤] │  ← EditorInputBar
├─────────────────────────────────────┤
│  状态: 就绪                          │
└─────────────────────────────────────┘
```

## 组件

| 组件           | 文件                         | 说明                                                      |
| -------------- | ---------------------------- | --------------------------------------------------------- |
| RPC 客户端     | `src/agent/AgentClient.ts`   | 用 `requestUrl` 绕过 CORS，调用 duoduo daemon 的 JSON-RPC |
| 编辑器输入栏   | `src/ui/EditorInputBar.ts`   | 底部常驻输入区，流式更新 callout                          |
| Callout 格式化 | `src/markdown/ChatParser.ts` | 用户消息 `> [!agent-user]`，回复 `> [!agent]`             |
| 主插件         | `src/main.ts`                | 自动附加到 Markdown 视图                                  |

## 通信流程

```
用户输入 → EditorInputBar → AgentClient.channel.ingress
                                    ↓
                            duoduo daemon
                                    ↓
                            AgentClient.channel.pull (轮询)
                                    ↓
EditorInputBar ← onMessage/onStreamEnd ← 流式/最终消息
       ↓
  更新编辑器中的 callout
```

## 使用注意事项

1. **必须配置 Session Key**：设置中填写有效的 `lark:oc_xxx:ou_xxx` 格式 session key
2. **Markdown 视图即可**：只要是 Markdown 视图就显示输入栏，包括默认的编辑+预览分屏模式
3. **Daemon 必须运行**：需要先启动 `duoduo daemon`（默认 `127.0.0.1:20233`）
4. **快捷键**：`Cmd+I` 聚焦输入栏

## 文件结构

```
obsidian-agent-chat/
├── src/
│   ├── main.ts              # 插件入口，注册命令和事件
│   ├── agent/
│   │   ├── AgentClient.ts   # JSON-RPC 客户端（使用 requestUrl）
│   │   └── index.ts
│   ├── ui/
│   │   ├── EditorInputBar.ts # 编辑器底部常驻输入栏
│   │   └── index.ts
│   ├── markdown/
│   │   ├── ChatParser.ts    # 解析/格式化 callout
│   │   ├── ChatUpdater.ts   # 更新 markdown 文件
│   │   └── index.ts
│   └── types/
│       ├── protocol.ts      # JSON-RPC 协议类型
│       ├── chat.ts          # 聊天领域类型和默认设置
│       └── index.ts
├── styles.css               # 输入栏和 callout 样式
├── manifest.json
└── main.js                  # 构建产物
```
