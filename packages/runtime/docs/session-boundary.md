# Session 层边界设计

## 1. 当前架构问题

```
packages/runtime/             ← 纯逻辑，平台无关。✅
packages/shared/              ← 共享类型和接口。✅
src/main/agent/adapters/      ← 平台适配器，实现 shared 接口。✅
src/main/agent/runtime/agentTurnService.ts  ← 编排逻辑，直接 import @main/db/services。❌
```

编排逻辑（创建 conversation、写入消息、加载历史、构建上下文、启动 runtime loop）被硬编码在 Electron 主进程中。做 Web 版时这些逻辑无法复用。

## 2. Session 定义

在 ant-chat 中，**Session** 指一次用户交互的完整生命周期：

```
用户发送消息 → 创建 conversation / message → 加载历史 → 构建上下文
→ 启动 AgentRuntime loop → 流式响应 → 工具调用 → 审批 → 完成/失败
```

session 层负责**编排**这个生命周期，runtime 的 loop 层负责**执行**单个 turn 内的 step 循环。

## 3. 目标架构

```
                        ┌─────────────────────────────────────┐
                        │    packages/runtime/src/session/    │  ← 新增核心
                        │    SessionOrchestrator               │
                        │    .startTurn(options) → TurnResult  │
                        │    内部编排：                         │
                        │    1. 创建/获取 conversation          │
                        │    2. 创建 user message              │
                        │    3. 加载历史 → LoopMessage[]       │
                        │    4. 构建 system prompt + tools      │
                        │    5. 启动 AgentRuntime.startTask()  │
                        │    6. 监听事件处理完成/失败           │
                        └──────┬──────────────┬───────────────┘
                               │ 依赖接口      │
                        ┌──────┴──────────────┴───────────────┐
                        │  ISessionStore      (新增)          │
                        │  IModelResolver     (已有)          │
                        │  IToolProvider      (已有，隐式)     │
                        │  IAIProviderFactory (已有)           │
                        │  IAgentEventEmitter (已有)           │
                        │  ILogger            (已有)          │
                        └─────────────────────────────────────┘
                               │              │
                        ┌──────┴──┐    ┌──────┴──┐
                        │ Electron│    │   Web   │
                        │  Dexie  │    │  PG/REST│
                        └─────────┘    └─────────┘
```

## 4. 各层职责边界

| 层           | 负责                                                                               | 不负责                                        |
| ------------ | ---------------------------------------------------------------------------------- | --------------------------------------------- |
| **session**  | 编排完整 turn 生命周期；管理 conversation/message CRUD 流程；协调 adapter 调用顺序 | 不执行 AI loop；不处理工具调用；不直接访问 DB |
| **loop**     | 单 turn 内的 step 循环；模型流式调用；工具执行；token 压缩                         | 不创建 conversation/message；不知道 IPC/DB    |
| **policy**   | 工具调用前的策略检查；审批流程控制                                                 | 不关心业务上下文                              |
| **adapters** | 实现接口绑定具体平台（DB/IPC/AI）                                                  | 不含业务逻辑                                  |

## 5. 核心抽象：`ISessionStore`

统一 session 层的读写操作，替代目前散落在 `@main/db/services` 的直接调用：

```typescript
export interface ISessionStore {
  // Conversation
  getConversation: (id: string) => Promise<IConversations | null>
  createConversation: (data: CreateConversationInput) => Promise<IConversations>

  // Messages
  getMessages: (convId: string) => Promise<IMessage[]>
  addMessage: (data: AddMessage) => Promise<IMessage>

  // Task 管理（会话维度的活跃任务查询）
  listActiveTasks: (conversationId?: string) => Promise<AgentTaskSnapshot[]>
}
```

`ISessionStore` 与已有的 `IConversationQuery` 区别：

- `IConversationQuery` —— 只读查询接口，已存在
- `ISessionStore` —— 包含**写入**操作的完整接口，新增

## 6. `SessionOrchestrator` 接口

```typescript
export interface SessionOrchestratorConfig {
  sessionStore: ISessionStore
  modelResolver: IModelResolver
  toolProvider: ToolProvider
  aiProviderFactory: AIProviderFactory
  eventEmitter: IAgentEventEmitter
  logger: ILogger
}

export interface SessionOrchestrator {
  startTurn: (options: StartAgentTurnOptions) => Promise<AgentTurnResult>
}

export function createSessionOrchestrator(
  config: SessionOrchestratorConfig
): SessionOrchestrator
```

## 7. 与 AgentRuntime 的关系

```
SessionOrchestrator.startTurn()
  │
  ├─ 前置：准备数据（DB 读/写，构建上下文，解析 model）
  │
  ├─ 调用 agentRuntime.startTask(RuntimeStartInput)
  │     └─ runAgentLoop()   ← loop 层
  │           ├─ emitTurnStarted
  │           ├─ for each step: stream → emitTurnChunk → tool calls → emitTurnToolCalls
  │           └─ emitTurnFinished / emitTaskUpdated
  │
  └─ 后置：agentRuntime 只 emit 事件，session 层或适配器层消费事件做持久化
```

关键点：AgentRuntime **不知道** session 层的存在。session 层调用 runtime，runtime 通过事件回调通知状态变化。

## 8. 数据流：Electron vs Web

```
Electron 实现:
  ElectronSessionStore implements ISessionStore
    → Dexie (IndexedDB)
  ElectronEventEmitter implements IAgentEventEmitter
    → IPC → renderer Zustand store

Web 实现:
  WebSessionStore implements ISessionStore
    → REST API / PostgreSQL
  WebEventEmitter implements IAgentEventEmitter
    → WebSocket / SSE → 浏览器状态管理
```

两个平台**共用** `packages/runtime/src/session/SessionOrchestrator`，只换 `ISessionStore` 和 `IAgentEventEmitter` 的实现。

## 9. 迁移计划

1. 定义 `ISessionStore` 接口（`packages/shared/`）
2. 实现 `SessionOrchestrator`（`packages/runtime/src/session/`）
3. Electron 侧：`ElectronSessionStore` 适配现有 `@main/db/services`
4. `agentTurnService.ts` 瘦身 → 仅做依赖注入，编排逻辑移到 `SessionOrchestrator`
5. Web 侧：`WebSessionStore` 对接后端 API

## 10. 遗留问题

- **`WorkspaceStore`**：当前 `agentTurnService` 用 Electron 专用的 `WorkspaceStore.getInstance()` 获取 `workspacePath`。需要抽象为 `IWorkspaceResolver` 或由调用方传入。
- **Compaction 持久化**：当前在 compaction gate 内直接调用 `eventEmitter.emitCompactionSaved()`，持久化逻辑在适配器层完成。session 层不需要关心。
- **Skill 管理**：skill 的安装/选择涉及文件系统操作，暂留在平台适配器层。
