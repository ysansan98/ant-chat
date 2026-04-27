# P2：Agent Runtime 与审批

## 目标

- 在 P1 的工作区和工具基础上，实现最小 L2 Agent Runtime。
- 接入风险分级、审批状态机、托管模式。

## 范围

- `startTask()` / `cancelTask()`。
- Runtime 内存 task 状态。
- plan/act/observe 最小循环。
- 风险分级：L0/L1/L2。
- 执行模式：strict/hybrid/full_managed。
- 审批事件与审批 UI。
- 预算限制。
- 输入框上方轻量进度列表。

## 交付物

- Agent Runtime MVP。
- Policy Engine。
- approval IPC/events。
- progress UI。

## 实现要点

### Agent IPC

新增 `src/main/domains/agent/ipc.ts`，groupName 建议为 `agent`。

```ts
interface AgentStartTaskPayload {
  conversationId: string
  userMessageId: string
  prompt: string
  mode?: 'strict' | 'hybrid' | 'full_managed'
  workspacePath?: string
  budget?: {
    maxSteps?: number
    maxDurationMs?: number
    maxTokens?: number
  }
}

type StartTaskResponse = IpcResponse<{
  taskId: string
  status: 'running' | 'awaiting_approval'
}>
```

建议方法：
- `startTask(payload)`
- `approvePendingAction(taskId)`
- `rejectPendingAction(taskId, reason?)`
- `cancelTask(taskId)`

task 只存在于运行时，不落独立数据表。

### Renderer 事件

```ts
'agent:state-updated': [
  {
    taskId: string
    status: 'running' | 'awaiting_approval' | 'success' | 'failed' | 'cancelled'
    message?: string
  }
]

'agent:progress-updated': [
  {
    taskId: string
    items: Array<{
      id: string
      title: string
      status: 'done' | 'running' | 'pending'
    }>
  }
]

'agent:approval-required': [
  {
    taskId: string
    riskLevel: 'L1' | 'L2'
    title: string
    description: string
    timeoutAt?: number
  }
]
```

### 状态与持久化边界

- Runtime 维护内存 task 状态。
- 不新增 `agent_runs`、`agent_steps`、`agent_tool_calls`、`agent_approval_events`。
- 不持久化审批历史、工具调用历史、进度列表。
- 复杂任务最终结果仍以 assistant message 写入会话。

### 错误码

- `AGENT_TASK_NOT_FOUND`
- `AGENT_TASK_NOT_APPROVABLE`
- `AGENT_POLICY_BLOCKED`
- `AGENT_BUDGET_EXCEEDED`
- `AGENT_TOOL_EXEC_FAILED`

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

## 测试

见 [TESTPLAN.md](./TESTPLAN.md)。
