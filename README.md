# duoduo-in-obsidian

让 Obsidian 成为 duoduo agent 的原生对话界面。对话直接写入当前 Markdown 笔记，与笔记内容融为一体。

## 设计思路

大多数 AI 插件把对话放在独立的侧边栏，这意味着你的对话和笔记是两个世界。

这个插件反过来：**对话就是笔记**。每条消息直接写入当前打开的 `.md` 文件，用普通 Markdown 记录，随时可以编辑、引用、搜索。

### 消息格式

采用 HR 分隔格式，源码和渲染视图都保持干净：

```markdown
---
**You** · 10:05

帮我写一个防抖函数

---
**Agent** · 10:05

好的，这是一个 TypeScript 实现：

\`\`\`typescript
function debounce<T extends (...args: unknown[]) => void>(fn: T, delay: number): T {
  let timer: ReturnType<typeof setTimeout>;
  return ((...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  }) as T;
}
\`\`\`
```

选择这个格式而不是 Callout (`> [!agent]`) 的原因：

- **源码无噪音**：多行回复不需要每行都加 `> ` 前缀
- **streaming 稳定**：流式输出是 append-only，不需要全文扫描重写，彻底消除跳动
- **笔记可读**：文件可以直接分享或迁移，无需了解特殊语法

## 架构

```
┌─────────────────────────────────────────┐
│  Obsidian Markdown 视图                  │
│                                         │
│  # 我的笔记                              │
│                                         │
│  ---                                    │
│  **You** · 10:05                        │
│                                         │
│  帮我写一个防抖函数                       │
│                                         │
│  ---                                    │
│  **Agent** · 10:05                      │
│                                         │
│  好的，这是一个实现...                    │
│                                         │
├─────────────────────────────────────────┤
│  [与 Agent 对话... (Enter 发送)]   [发送] │  ← EditorInputBar
├─────────────────────────────────────────┤
│  状态: 就绪                              │
└─────────────────────────────────────────┘
```

## 前置条件

- **duoduo daemon** 在本地运行（默认 `http://127.0.0.1:20233`）
- **Session Key**：格式为 `lark:oc_xxx:ou_xxx`，在插件设置中填写

## 使用

1. 打开任意 Markdown 文件，底部会出现输入栏
2. 输入消息，按 `Enter` 发送（`Shift+Enter` 换行）
3. 回复以流式方式实时写入当前文件
4. 通过命令面板执行 `Create new chat note` 可快速新建对话笔记

## 文件结构

```
src/
├── main.ts                 # 插件入口，注册命令和事件
├── agent/
│   └── AgentClient.ts      # JSON-RPC 客户端，requestUrl + pull 轮询
├── ui/
│   └── EditorInputBar.ts   # 编辑器底部常驻输入栏
├── markdown/
│   ├── ChatParser.ts       # 消息格式化与解析（HR 格式）
│   └── ChatUpdater.ts      # Vault 文件操作
└── types/
    ├── chat.ts             # 聊天领域类型
    └── protocol.ts         # JSON-RPC 协议类型
```

## 通信流程

```
用户输入 → EditorInputBar → AgentClient.channel.ingress
                                        ↓
                                duoduo daemon
                                        ↓
                           AgentClient.channel.pull（长轮询）
                                        ↓
                     onStreamStart → 插入 HR header（记录 body 起始行）
                     onMessage    → append-only 更新 body
                     onStreamEnd  → 移除光标符，恢复就绪状态
```

## 开发

```bash
bun install
bun run dev     # 监听模式，自动重新构建
bun run build   # 生产构建
```

构建产物 `main.js` 放入 Obsidian vault 的插件目录即可加载。
