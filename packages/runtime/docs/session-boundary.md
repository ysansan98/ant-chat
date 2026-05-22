# Session 层边界设计

## 1. 当前架构问题

```
packages/runtime/             ← 纯逻辑，平台无关。✅
packages/shared/              ← 共享类型和接口。✅
src/main/agent/adapters/      ← 平台适配器，实现 shared 接口。✅
src/main/agent/runtime/agentTurnService.ts  ← 编排逻辑，直接 import @main/db/services。❌
```

编排逻辑（创建 conversation、写入消息、加载历史、构建上下文、启动 runtime loop）被硬编码在 Electron 主进程中。做 Web 版时这些逻辑无法复用。

## 2. AgentRuntime 定位

**AgentRuntime 是一个独立、自管理、无 TUI/CLI 的服务进程**，类似 Claude Code 的引擎层但去掉了交互界面。Electron 和 Web 只是它的 UI 壳，通过 IPC/HTTP 协议与之通信。

核心决策：

| 决策     | 结论                           | 理由                                                                    |
| -------- | ------------------------------ | ----------------------------------------------------------------------- |
| 进程模型 | **单例**                       | 一个 agent 服务所有 conversation 并发执行，taskStore 已支持多 task 并发 |
| 通信方式 | **跨进程**（IPC / HTTP）       | 暂不在浏览器中运行；agent 可独立部署、升级、崩溃恢复                    |
| 编排归属 | **AgentRuntime 内部**          | 外部只传 prompt + convId + modelId + workspacePath，agent 自己管理会话  |
| 事件模式 | **push**（IAgentEventEmitter） | 实时推送给 UI，简单直接；后续可加 pull 迭代器做背压                     |

## 3. 目标架构

```
                    ┌────────────────────────────────────────┐
                    │           AgentRuntime                 │
                    │         (独立进程，自管理)               │
                    │                                        │
                    │  构造注入:                              │
                    │   ISessionStore     IModelResolver      │
                    │   IAIProviderFactory  IToolProvider     │
                    │   IAgentEventEmitter  ILogger           │
                    │                                        │
                    │  ── 命令接口（写） ──                    │
                    │  startTask(options)                     │
                    │    → 内部: 创建/获取 conversation       │
                    │    → 创建 user message                  │
                    │    → 加载历史 → LoopMessage[]           │
                    │    → 构建 system prompt + tools         │
                    │    → 跑 loop → emit 事件                 │
                    │  approvePendingAction(...)              │
                    │  rejectPendingAction(...)               │
                    │  cancelTask(...)                        │
                    │                                        │
                    │  ── 查询接口（读，纯展示用） ──           │
                    │  listConversations()                    │
                    │  getConversation(id)                    │
                    │  getMessages(convId)                    │
                    │  getTask(taskId)                        │
                    │  listActiveTasks(convId?)               │
                    │                                        │
                    │  ── 事件出口 ──                         │
                    │  RuntimeEvent (push via eventEmitter)   │
                    └────────────────────────────────────────┘
                          ▲ 命令+查询        │ 事件流 (push)
                  ┌───────┴────────┐  ┌──────┴──────────┐
                  │  Electron      │  │     Web          │
                  │  IPC 代理      │  │  HTTP/WS 代理    │
                  │  Dexie 实现    │  │  PG/REST 实现    │
                  └────────────────┘  └─────────────────┘
```

## 4. 各层职责边界

| 层               | 负责                                                                       | 不负责                            |
| ---------------- | -------------------------------------------------------------------------- | --------------------------------- |
| **AgentRuntime** | 会话全生命周期（创建 conv、写 msg、加载历史、跑 loop）；审批流程；查询接口 | 不实现具体 DB/HTTP；不直接渲染 UI |
| **loop**         | 单 turn 内的 step 循环；模型流式调用；工具执行；token 压缩                 | 不创建 conversation/message       |
| **policy**       | 工具调用前的策略检查；审批流程控制                                         | 不关心业务上下文                  |
| **adapters**     | 实现接口绑定具体平台（DB/IPC/AI）；代理通信协议                            | 不含业务逻辑                      |

关键变化：**不再有独立的 SessionOrchestrator 层**。原来 `agentTurnService.ts` 的编排逻辑和 `AgentRuntime` 合并为同一个模块，AgentRuntime 直接暴露外部可调用的方法。

## 5. 核心抽象：`ISessionStore`

统一 AgentRuntime 对持久化层的读写依赖，替代目前散落在 `@main/db/services` 的直接调用：

```typescript
export interface ISessionStore {
  // Conversation
  getConversation: (id: string) => Promise<IConversations | null>
  createConversation: (data: CreateConversationInput) => Promise<IConversations>
  listConversations: () => Promise<IConversations[]>

  // Messages
  getMessages: (convId: string) => Promise<IMessage[]>
  addMessage: (data: AddMessage) => Promise<IMessage>
}
```

`ISessionStore` 合并了原有的 `IConversationQuery`（只读）并补上了写入操作。AgentRuntime 的查询接口直接委托给 `ISessionStore`。

## 6. `AgentRuntime` 公共接口

```typescript
// ======= 构造 =======
export interface AgentRuntimeConfig {
  sessionStore: ISessionStore
  modelResolver: IModelResolver
  aiProviderFactory: AIProviderFactory
  toolProvider: ToolProvider
  eventEmitter: IAgentEventEmitter
  logger: ILogger
}

export class AgentRuntime {
  constructor(config: AgentRuntimeConfig) {}

  // ======= 命令（写） =======
  startTask: (options: {
    prompt: string
    conversationId?: string
    modelId: string
    workspacePath: string
    mode?: AgentMode
    images?: IAttachment[]
    attachments?: IAttachment[]
    referencedFiles?: string[]
    selectedSkill?: string
    chatSettings?: {
      systemPrompt?: string
      temperature?: number
      maxTokens?: number
    }
  }) => Promise<{ taskId: string, conversationId: string, userMessageId: string }>

  approvePendingAction: (options: { taskId: string, actionId: string }) => void
  rejectPendingAction: (options: { taskId: string, actionId: string, reason?: string }) => void
  cancelTask: (options: { taskId: string }) => void

  // ======= 查询（读，纯展示） =======
  getTask: (taskId: string) => AgentTaskSnapshot
  listActiveTasks: (conversationId?: string) => AgentTaskSnapshot[]
  listConversations: () => Promise<IConversations[]>
  getConversation: (id: string) => Promise<IConversations | null>
  getMessages: (convId: string) => Promise<IMessage[]>
}
```

## 7. startTask 内部流程

```
AgentRuntime.startTask(options)
  │
  ├─ 1. 创建/获取 conversation（ISessionStore）
  │
  ├─ 2. 创建 user message（ISessionStore）
  │
  ├─ 3. 解析 model & provider（IModelResolver）
  │
  ├─ 4. 创建 AI provider（IAIProviderFactory）
  │
  ├─ 5. 加载历史消息 → 构建 LoopMessage[]（ISessionStore + buildConversationContextMessages）
  │
  ├─ 6. 准备工具（IToolProvider）
  │
  ├─ 7. 构建 system prompt（createLoopSystemPrompt）
  │
  ├─ 8. 启动 loop → emit 事件（runAgentLoop）
  │     ├─ emitTurnStarted
  │     ├─ for each step: stream → emitTurnChunk → execute tools → emitTurnToolCalls
  │     ├─ 需要审批时: emitTaskUpdated + emitApprovalRequired
  │     └─ 结束: emitTurnFinished + emitTaskUpdated
  │
  └─ 9. 返回 { taskId, conversationId, userMessageId }
```

## 8. 跨进程通信模型

```
Electron 实现:
  ┌──────────────┐         IPC          ┌──────────────────┐
  │   Renderer   │ ←─── 事件 push ──── │   Main Process    │
  │  (Zustand)   │ ──── 命令/查询 ───→ │   AgentRuntime    │
  │              │                      │   + Dexie 适配器   │
  └──────────────┘                      └──────────────────┘

Web 实现:
  ┌──────────────┐      HTTP/WS          ┌──────────────────┐
  │   Browser    │ ←─── WS 事件 push ── │   Agent Server    │
  │  (状态管理)   │ ──── REST 命令/查询 ─→│   AgentRuntime    │
  │              │                       │   + PG 适配器     │
  └──────────────┘                       └──────────────────┘
```

- **命令/查询**：请求-响应模式。Electron 走 IPC `invoke/handle`，Web 走 REST API
- **事件流**：服务端 push。Electron 走 IPC `send/on`，Web 走 WebSocket
- 两个平台**共用** `AgentRuntime`，只换 `ISessionStore`、`IAgentEventEmitter` 和通信协议层

## 9. 迁移计划

1. 补齐 `ISessionStore` 接口（`packages/shared/`）—— 合并原有 `IConversationQuery`
2. `AgentRuntime` 扩展：纳入编排逻辑、暴露查询接口
3. Electron 侧：
   - `ElectronSessionStore` 适配现有 `@main/db/services`
   - `agentTurnService.ts` 删除，逻辑已移入 AgentRuntime
   - IPC handler 层做薄代理（转发 invoke → AgentRuntime 方法调用）
4. Web 侧：
   - `WebSessionStore` 对接后端 API
   - HTTP handler + WebSocket 事件推送
5. 通信协议统一：定义 `IAgentTransport` 接口规范

## 10. 遗留问题

- **`WorkspaceStore`**：当前用 Electron 专用的 `WorkspaceStore.getInstance()` 获取 `workspacePath`。Web 版需要对应的抽象（`IWorkspaceResolver`）或由调用方传入。
- **Compaction 持久化**：在 loop 内通过 `eventEmitter.emitCompactionSaved()` 推送，持久化由适配器层完成。AgentRuntime 不关心存储细节。
- **Skill 管理**：skill 的安装/选择涉及文件系统操作，暂留在平台适配器层。
