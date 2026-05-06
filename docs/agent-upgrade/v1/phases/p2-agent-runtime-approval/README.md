# P2：Agent Runtime 与审批

## 目标

- 在 P1 的工作区和内置工具基础上，实现最小 L2 Agent Runtime。
- 接入风险分级、审批状态机、托管模式和预算限制。
- 保持简单聊天链路稳定，复杂任务才进入 Agent Runtime。

## 范围

- `startTask()` / `approvePendingAction()` / `rejectPendingAction()` / `cancelTask()`。
- Runtime 内存 task 状态。
- plan/act/observe 最小循环。
- 风险分级：L0/L1/L2。
- 执行模式：strict/hybrid/full_managed。
- 审批事件与审批 UI。
- 预算限制。
- 输入框上方轻量进度列表。

## 不在 P2 范围

- 不实现长期运行的后台队列。
- 不新增 `agent_runs`、`agent_steps`、`agent_tool_calls`、`agent_approval_events` 表。
- 不把进度、工具调用历史、审批历史写入 `messages.metadata`。
- 不把现有 Renderer 端 MCP 手动执行链路改成 Agent 自动执行链路；Agent Runtime 的工具执行权必须在 Main 进程内。
- 不做 P3 的 Skill FS-first 能力，也不做 P4 之后的大 Shell UI 改造。

## 交付物

- Agent Runtime MVP。
- Policy Engine。
- approval IPC/events。
- progress UI。
- Agent task store 和 renderer agent store。
- Agent checkpoint 临时文件。
- Agent runtime 结构化日志文件。
- 复杂任务路由，简单聊天保持原链路。

## 现有代码审查结论

### 当前链路

- `src/renderer/src/components/Chat/Chat.tsx` 在提交时创建会话、写入 user message，然后调用 `onRequestAction()`。
- `src/renderer/src/store/messages/actions.ts` 通过 `chatApi.sendChatCompletions()` 进入 Main。
- `src/main/domains/chat/ipc.ts` 调用 `handleChatCompletions()`。
- `src/main/ai-providers/services/chat-service.ts` 同时负责 provider 初始化、读取历史消息、创建 assistant message、消费模型流、更新数据库、向 Renderer 推送 `chat:stream-message`。
- MCP 工具调用结果当前挂在 `messages.mcpTool` 上，由 `src/renderer/src/store/messages/mcpToolActions.ts` 在 Renderer 端调用 `mcp.callTool()` 后写回 message。
- P1 内置工具已经在 `src/main/agent/native-tools/` 下落地，`NativeToolService` 暴露 `read_file`、`list_dir`、`glob_files`、`grep_files`、`write_file`、`apply_patch`、`bash`，并带有路径约束和风险推断。

### 主要问题

- `chat-service.ts` 是浅模块：一个函数混合模型调用、DB 写入、IPC 推送和错误处理，Agent loop 如果继续堆进去会放大复杂度。
- 工具执行权分散：普通 MCP 工具由 Renderer 触发，P1 Native 工具由 Main 提供。Agent 审批必须集中在 Main，否则策略、审批和实际执行会出现竞态。
- 消息状态和 task 状态没有边界：复杂任务进度如果塞进 `IMessage`，会污染持久化模型，也会让刷新、分页和普通聊天承担 Agent 细节。
- 现有 `StreamAbortController` 只按 conversation 取消聊天流，不能表达 task、pending action、工具执行和预算停止。
- `IpcRendererEvent` 还没有 Agent 事件的强类型定义，后续 UI 监听容易退化成字符串约定。

## 重构方案

### 模块拆分

P2 新增 Main 侧 Agent 模块，按信息隐藏而不是执行顺序拆分：

| 模块 | 路径 | 职责 |
| --- | --- | --- |
| Agent IPC | `src/main/domains/agent/ipc.ts` | 暴露 task 控制 API，做入参校验和错误响应。 |
| Agent Runtime | `src/main/agent/runtime/agentRuntime.ts` | 管理 task 生命周期、plan/act/observe loop、取消和预算停止。 |
| Task Store | `src/main/agent/runtime/taskStore.ts` | 保存内存 task、pending action、AbortController。 |
| Policy Engine | `src/main/agent/policy/policyEngine.ts` | 根据 mode、risk、workspace policy 产出 allow/approval/block 决策。 |
| Tool Registry | `src/main/agent/tools/toolRegistry.ts` | 聚合 P1 NativeToolService，统一风险推断和执行入口。 |
| Approval Gate | `src/main/agent/runtime/approvalGate.ts` | 创建 pending action，等待 approve/reject/timeout，并恢复 loop。 |
| Progress Reporter | `src/main/agent/runtime/progressReporter.ts` | 只负责发 `agent:*` 事件，不写 DB。 |
| Message Writer | `src/main/agent/runtime/agentMessageWriter.ts` | 只写最终 assistant message 或单条 loading/success/error/cancel message。 |
| Checkpoint Store | `src/main/agent/runtime/checkpointStore.ts` | 原子写入 task 临时 checkpoint，支持应用重启后恢复。 |
| Agent Logger | `src/main/agent/runtime/agentLogger.ts` | 写入 task 全生命周期结构化日志。 |

`src/main/bridge.ts` 需要注册 `AgentIpcService`。`packages/shared/src/ipc-events.ts` 和 shared interfaces 需要补 Agent 类型，避免 Renderer 使用裸字符串。

### Chat 链路调整

保留普通聊天路径，不把所有请求都迁移到 Agent：

1. `Chat.onSubmit()` 继续负责创建会话和 user message。
2. 新增一个轻量任务路由函数，例如 `shouldStartAgentTask(prompt, attachments, mode)`。
3. 简单问题继续调用 `onRequestAction()`，沿用 `chat.sendChatCompletions`。
4. 复杂任务调用 `agentApi.startTask()`，传入 `conversationId`、`userMessageId`、`prompt`、`mode`、`workspacePath`、`budget`。
5. `cancel` 按当前活动状态分流：普通聊天调用 `chat.cancelChatCompletions()`，Agent task 调用 `agent.cancelTask()`。

P2 的任务路由应先使用确定性规则，避免为了分类再引入一个模型调用。建议触发 Agent 的条件：用户明确要求检查项目、读取/修改文件、运行命令、总结代码、批量操作、生成 patch，或附件/工作区上下文需要工具辅助。普通事实问答、闲聊、纯解释问题继续走普通聊天。

### 模型调用重构

从 `chat-service.ts` 提取可复用的模型流入口，避免 Agent Runtime 依赖聊天持久化副作用。

建议拆成：

- `createChatModelRunner()`：负责 provider 初始化和 `sendChatCompletions()`。
- `handleChatCompletions()`：保留普通聊天的 DB 和 IPC 行为。
- `AgentRuntime`：复用 model runner，但自行决定 prompt、tools、observe 结果和最终 message 写入。

这样普通聊天和 Agent Runtime 共享模型接入，但不共享状态机。

## 运行时模型

### Task 状态

```ts
type AgentTaskStatus =
  | 'running'
  | 'awaiting_approval'
  | 'success'
  | 'failed'
  | 'cancelled'

type AgentErrorCode =
  | 'AGENT_TASK_NOT_FOUND'
  | 'AGENT_TASK_ALREADY_RUNNING'
  | 'AGENT_TASK_NOT_APPROVABLE'
  | 'AGENT_APPROVAL_ACTION_MISMATCH'
  | 'AGENT_APPROVAL_TIMEOUT'
  | 'AGENT_POLICY_BLOCKED'
  | 'AGENT_BUDGET_EXCEEDED'
  | 'AGENT_TOOL_EXEC_FAILED'
  | 'AGENT_CANCELLED'

interface AgentProgressItem {
  id: string
  title: string
  status: 'done' | 'running' | 'pending' | 'failed' | 'skipped'
}
```

```ts
interface AgentTaskSnapshot {
  taskId: string
  conversationId: string
  userMessageId: string
  workspacePath: string
  mode: AgentMode
  status: AgentTaskStatus
  createdAt: number
  updatedAt: number
  checkpointPath: string
  logPath: string
  errorCode?: AgentErrorCode
  errorMessage?: string
  pendingAction?: AgentPendingAction
  progress: AgentProgressItem[]
}
```

运行中 task 以内存状态为主，同时写入临时 checkpoint 文件。应用重启后 Runtime 扫描未完成 checkpoint，从最近安全边界恢复；Renderer 刷新后通过 `getTask()` 或启动事件重建 UI 状态。

checkpoint 不是长期历史，不进数据库。task 进入 `success`、`failed` 或 `cancelled` 后必须删除 checkpoint 文件。

### 状态转换

| 当前状态 | 事件 | 下一状态 |
| --- | --- | --- |
| running | 需要审批 | awaiting_approval |
| running | loop 完成 | success |
| running | 预算超限 | failed |
| running | 工具失败且不可恢复 | failed |
| running | 用户取消 | cancelled |
| awaiting_approval | approve | running |
| awaiting_approval | reject | running 或 failed |
| awaiting_approval | timeout | failed |
| awaiting_approval | 用户取消 | cancelled |

拒绝审批默认把该动作作为 observation 交回模型，让模型尝试替代方案；如果模型继续请求同一被拒动作或没有替代方案，task 结束为 `failed`。

### 预算

```ts
interface AgentBudget {
  maxSteps?: number
  maxDurationMs?: number
  maxTokens?: number
  maxToolCalls?: number
}
```

约束：

- `maxSteps` 统计 plan/act/observe loop 次数。
- `maxDurationMs` 从 task 创建时间开始统计。
- `maxToolCalls` 统计已执行工具次数，不包含被拒绝或被阻断的 action。
- `maxTokens` 在 P2 只作为传给模型的上限和最佳努力统计；只有 provider 返回 usage 时才做精确累计。
- 任一预算超限后停止 task，发送 `AGENT_BUDGET_EXCEEDED`，不得继续执行待审批动作。

## 策略与审批

### 风险等级

| 等级 | 含义 | 示例 |
| --- | --- | --- |
| L0 | 只读、无副作用 | `read_file`、`list_dir`、`glob_files`、`grep_files` |
| L1 | 工作区内低风险写入或低风险命令 | 新建文件、`mkdir -p` |
| L2 | 覆盖、删除、批量修改、配置/锁文件变更、未知命令 | `apply_patch` 删除文件、修改 `package.json`、非白名单 bash |

P1 `NativeToolService.inferRisk()` 是 P2 的基础风险来源。Policy Engine 不重新解析工具细节，只组合风险、模式和硬阻断。

### 模式矩阵

| Mode | L0 | L1 | L2 | 硬阻断 |
| --- | --- | --- | --- | --- |
| strict | 审批 | 审批 | 审批 | 直接阻断 |
| hybrid | 自动执行 | 审批 | 审批 | 直接阻断 |
| full_managed | 自动执行 | 自动执行 | 自动执行 | 直接阻断 |

硬阻断包括工作区越界、symlink 逃逸、危险 bash、路径策略失败、P1 工具返回 `AGENT_POLICY_BLOCKED`。硬阻断不弹审批，因为用户不应该通过审批绕过安全边界。

### Policy Engine 接口

```ts
interface PolicyDecisionInput {
  mode: AgentMode
  toolName: string
  riskLevel: AgentToolRisk
  input: Record<string, unknown>
  workspacePath: string
}

type PolicyDecision =
  | { type: 'allow' }
  | { type: 'require_approval', pendingAction: AgentPendingAction }
  | { type: 'block', code: 'AGENT_POLICY_BLOCKED', reason: string }
```

### Pending Action

审批必须绑定 `actionId`，不能只靠 `taskId`，避免旧审批卡片或重复点击误放行新动作。

```ts
interface AgentPendingAction {
  actionId: string
  taskId: string
  toolName: string
  riskLevel: 'L0' | 'L1' | 'L2'
  title: string
  description: string
  inputPreview: string
  createdAt: number
  timeoutAt?: number
}
```

`approvePendingAction(taskId, actionId)` 只允许批准当前 pending action。`rejectPendingAction(taskId, actionId, reason?)` 必须清空 pending action，并把拒绝原因写入 observation。重复 approve/reject 返回成功但不执行第二次，语义是幂等完成。

## Agent IPC

新增 `src/main/domains/agent/ipc.ts`，groupName 为 `agent`。

```ts
type AgentMode = 'strict' | 'hybrid' | 'full_managed'

interface AgentStartTaskPayload {
  conversationId: string
  userMessageId: string
  prompt: string
  mode?: AgentMode
  workspacePath?: string
  budget?: AgentBudget
}

type StartTaskResponse = IpcResponse<{
  taskId: string
  status: 'running' | 'awaiting_approval'
}>
```

固定方法：

- `startTask(payload)`。
- `approvePendingAction(taskId, actionId)`。
- `rejectPendingAction(taskId, actionId, reason?)`。
- `cancelTask(taskId)`。
- `getTask(taskId)`，用于 UI 初始化或调试面板读取内存快照。
- `listActiveTasks(conversationId?)`，用于 Renderer 刷新或会话切换后恢复当前 task UI。

错误码：

- `AGENT_TASK_NOT_FOUND`。
- `AGENT_TASK_ALREADY_RUNNING`。
- `AGENT_TASK_NOT_APPROVABLE`。
- `AGENT_APPROVAL_ACTION_MISMATCH`。
- `AGENT_APPROVAL_TIMEOUT`。
- `AGENT_POLICY_BLOCKED`。
- `AGENT_BUDGET_EXCEEDED`。
- `AGENT_TOOL_EXEC_FAILED`。
- `AGENT_CANCELLED`。

## Renderer 事件

```ts
'agent:state-updated': [
  {
    taskId: string
    conversationId: string
    userMessageId: string
    status: 'running' | 'awaiting_approval' | 'success' | 'failed' | 'cancelled'
    message?: string
    errorCode?: AgentErrorCode
  }
]

'agent:progress-updated': [
  {
    taskId: string
    conversationId: string
    items: Array<{
      id: string
      title: string
      status: 'done' | 'running' | 'pending' | 'failed' | 'skipped'
    }>
  }
]

'agent:approval-required': [
  {
    taskId: string
    conversationId: string
    action: AgentPendingAction
  }
]

'agent:task-recovered': [
  {
    task: AgentTaskSnapshot
  }
]
```

事件必须写入 `packages/shared/src/ipc-events.ts`，Renderer 只通过 `useIpcEventListener()` 注册监听。

## Renderer 接入

新增最小 UI 和状态，不改大布局：

- `src/renderer/src/api/agentApi.ts`：封装 `ipc.agent.*`。
- `src/renderer/src/store/agent/store.ts`：按 `taskId` 保存 task snapshot、progress、pending action。
- `src/renderer/src/store/agent/actions.ts`：处理 `agent:*` 事件和 approve/reject/cancel。
- `src/renderer/src/components/Agent/AgentProgressList.tsx`：显示输入框上方轻量进度列表。
- `src/renderer/src/components/Agent/AgentApprovalCard.tsx`：显示紧凑审批条，不使用 modal。
- `Chat.tsx`：在 `Sender` 上方挂载 progress/approval；提交时按任务路由选择 chat 或 agent。

UI 行为：

- 简单聊天不渲染 Agent 进度 UI。
- 同一 conversation 同时只允许一个 running/awaiting_approval task；再次提交复杂任务前先取消旧 task 或返回 `AGENT_TASK_ALREADY_RUNNING`。
- 审批卡片展示工具名、风险、说明、输入预览、超时时间。
- task 完成、失败或取消后，进度列表保留短暂状态，然后从内存 store 移除。
- 切换工作区或会话时只展示当前 conversation 的 active task。
- Renderer 刷新后需要从 Main 的 active/recovered task 快照恢复进度和审批卡片。

这部分需要 UI 调整，但只做 Agent 最小接入，不做整体布局重构。调整范围限定在 `Chat.tsx` 输入框上方区域、Agent store、Agent API 和两个轻量组件。

## 状态与持久化边界

- Runtime 维护内存 task 状态，并为未完成 task 写入临时 checkpoint。
- 不新增 `agent_runs`、`agent_steps`、`agent_tool_calls`、`agent_approval_events`。
- 不把审批历史、工具调用历史、进度列表写入数据库或长期 task history；未完成 task 的 checkpoint 和诊断日志除外。
- 复杂任务最多写入一条 assistant message：运行中可为 `loading`，结束时更新为 `success`、`error` 或 `cancel`。
- 工具 observation 不作为独立 message 存储，只作为 Runtime loop 内部上下文。
- 审批拒绝、预算超限、硬阻断需要在最终 assistant message 中给出用户可理解的摘要。

### 临时 checkpoint

checkpoint 建议放在应用 userData 下的 `agent/tasks/<taskId>.json`，不要写进工作区，避免污染用户项目。

```ts
interface AgentTaskCheckpoint {
  version: 1
  task: AgentTaskSnapshot
  budgetUsage: {
    steps: number
    toolCalls: number
    tokens?: number
    startedAt: number
  }
  loopState: {
    lastCompletedStepId?: string
    observations: Array<{
      id: string
      toolName?: string
      content: string
      createdAt: number
    }>
    rejectedActionIds: string[]
  }
}
```

写入规则：

- 每次 task 状态变化、progress 变化、pending action 创建/清空、预算计数变化后都要原子写 checkpoint。
- 工具执行前写入 `running` 中的 action 标记，工具执行成功后写入 observation。
- 应用重启时，如果 checkpoint 处于 `awaiting_approval`，恢复为等待审批并重新发 `agent:approval-required`。
- 应用重启时，如果 checkpoint 处于工具或模型调用中间态，不能恢复进程现场；Runtime 从最近完成的 observation 边界继续，并在日志中记录 `task_recovered_after_interrupt`。
- checkpoint 解析失败时，移动到 `agent/tasks/corrupt/`，task 标记为 `failed`，最终 assistant message 给出恢复失败说明。
- task 结束后删除 checkpoint 文件；删除失败只记录日志，不影响最终结果。

### 运行日志

Agent Runtime 必须为每个 task 写完整结构化日志，建议路径为 userData 下的 `agent/logs/<yyyy-mm-dd>/<taskId>.jsonl`。

每行一条 JSON 事件，至少包含：

- `timestamp`。
- `taskId`。
- `conversationId`。
- `workspacePath`。
- `event`。
- `level`。
- `message`。
- `data`。

必须记录的事件：

- `task_started`、`task_recovered`、`task_completed`、`task_failed`、`task_cancelled`。
- `checkpoint_written`、`checkpoint_deleted`、`checkpoint_corrupt`。
- `model_request_started`、`model_response_received`、`model_request_failed`。
- `tool_decision`、`tool_started`、`tool_completed`、`tool_failed`。
- `approval_required`、`approval_approved`、`approval_rejected`、`approval_timeout`。
- `budget_updated`、`budget_exceeded`。

日志不得写入 API Key、完整环境变量、用户本地敏感文件内容。工具输入和输出要做长度截断，默认单字段不超过 4KB。

## 取消与并发

- `cancelTask(taskId)` 必须中止模型流、停止后续 loop、清空 pending action，并尽力终止正在执行的工具。
- 已经开始的文件写入或 patch 需要依赖 P1 工具的原子性保证；取消不能留下半写入状态。
- 同一 conversation 只允许一个 active task。
- 不限制不同 conversation 同时运行 task，但每个 task 必须绑定创建时的 `workspacePath`，不能受用户后续切换工作区影响。
- 应用退出或崩溃时不强制把 task 标为失败，重启后由 checkpoint 恢复或进入可解释失败状态。

## 验收标准

- AC-P2-1：简单问题不显示 Agent 进度 UI，仍走普通聊天。
- AC-P2-2：复杂任务触发 Agent task。
- AC-P2-3：复杂任务显示输入框上方进度列表。
- AC-P2-4：进度列表状态包含已完成、进行中、未开始。
- AC-P2-5：用户可以取消运行中的 task。
- AC-P2-6：超过预算后 task 停止并给出错误提示。
- AC-P2-7：hybrid 下 L0 工具自动执行。
- AC-P2-8：hybrid 下 L1/L2 动作触发审批。
- AC-P2-9：审批拒绝后动作不执行。
- AC-P2-10：full_managed 下可自动推进，但硬阻断仍生效。
- AC-P2-11：strict 下任何工具动作都需要审批。
- AC-P2-12：审批 approve/reject 必须绑定 actionId，重复操作不得重复执行工具。
- AC-P2-13：同一 conversation 重复启动复杂任务时不会产生两个 active task。
- AC-P2-14：工作区切换后，已启动 task 仍使用创建时 workspacePath。
- AC-P2-15：Agent Runtime 不把进度、审批和工具历史写入数据库。
- AC-P2-16：未完成 task 写入临时 checkpoint，应用重启后可从最近安全边界继续，task 结束后删除 checkpoint。
- AC-P2-17：每个 Agent task 都有完整结构化日志文件，覆盖启动、恢复、审批、工具、预算、取消和结束事件。

## 测试

见 [TESTPLAN.md](./TESTPLAN.md)。
