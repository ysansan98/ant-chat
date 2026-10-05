import type { AgentPendingAction } from '@ant-chat/shared'
import type { TaskStore } from '../taskStore'
import type { BeforeToolExecuteInput, ToolAuthorization } from '../tools/types'
import { randomUUID } from 'node:crypto'
import { AgentError } from '../AgentError'
import { recordContextObservation } from '../observation'
import { emitNotificationHook, runPermissionRequestHook } from './lifecycleHooks'

export interface HookAwareAuthorizationDeps {
  taskStore: TaskStore
}

/**
 * 把 PreToolUse hook 串接到授权链的末端（D3）：
 *
 * `policy/审批（base）→ PreToolUse hook（deny/ask/context）→ 执行`
 *
 * - hook 只收紧，不能放宽 policy 结论；
 * - `deny` 直接 block（复用 continueAgent，让模型拿到可行动原因）；
 * - `ask` 复用现有审批流（taskStore.requestApproval）；automation 无人值守时降级为 block（D4）；
 * - `additionalContext` 随 allow 结果返回，由 toolExecution 追加到工具结果上下文。
 */
export function createHookAwareToolAuthorization(
  base: ToolAuthorization,
  deps: HookAwareAuthorizationDeps,
): ToolAuthorization {
  return async (input) => {
    const baseResult = await base(input)
    if (baseResult.outcome !== 'allow')
      return baseResult

    const hooks = input.config.hooks
    if (!hooks)
      return baseResult

    const hookResult = await runPreToolUse(hooks, input)
    if (!hookResult)
      return baseResult

    if (hookResult.decision === 'deny') {
      return {
        outcome: 'block',
        errorCode: 'AGENT_HOOK_DENIED',
        reason: hookResult.reason || `hook 阻止执行工具 ${input.prepared.toolName}`,
        continueAgent: true,
      }
    }

    if (hookResult.decision === 'ask') {
      const decision = await requestHookApproval(input, deps.taskStore, hookResult.reason)
      if (!decision.approved) {
        return {
          outcome: 'block',
          errorCode: decision.hookDenied
            ? 'AGENT_HOOK_DENIED'
            : decision.degraded
              ? 'AGENT_HOOK_ASK_BLOCKED'
              : 'AGENT_APPROVAL_REJECTED',
          reason: decision.reason || hookResult.reason || `hook 要求确认，未获批准：${input.prepared.toolName}`,
          continueAgent: true,
        }
      }
    }

    return hookResult.additionalContext
      ? { outcome: 'allow', additionalContext: hookResult.additionalContext }
      : { outcome: 'allow' }
  }
}

async function runPreToolUse(
  hooks: NonNullable<BeforeToolExecuteInput['config']['hooks']>,
  input: BeforeToolExecuteInput,
) {
  const { task, prepared, config } = input
  try {
    const result = await hooks.run('PreToolUse', {
      hook_event_name: 'PreToolUse',
      session_id: task.snapshot.conversationId,
      conversation_id: task.snapshot.conversationId,
      cwd: task.snapshot.workspacePath,
      timestamp: Date.now(),
      tool_name: prepared.toolName,
      tool_input: prepared.input,
      operation_type: prepared.operationType,
      scope: prepared.scope,
      step: input.step,
      tool_call_id: input.toolCallId,
    }, {
      cwd: task.snapshot.workspacePath,
      signal: task.abortController.signal,
    })
    recordContextObservation(config, {
      kind: 'hook',
      hook_event_name: result.event,
      tool_name: prepared.toolName,
      tool_call_id: input.toolCallId,
      step: input.step,
      decision: result.decision,
      reason: result.reason,
      executions: result.executions.map(execution => ({
        source: execution.source,
        command: execution.command,
        decision: execution.decision,
        exitCode: execution.exitCode,
        timedOut: execution.timedOut,
        error: execution.error,
        durationMs: execution.durationMs,
      })),
    })
    return result
  }
  catch (error) {
    // hooks 运行时已做失败隔离；这里兜底，绝不让 hook 故障阻断主流程。
    config.logger?.warn('PreToolUse hook 执行失败，按无决策继续', error)
    return undefined
  }
}

async function requestHookApproval(
  input: BeforeToolExecuteInput,
  taskStore: TaskStore,
  hookReason: string | undefined,
): Promise<{ approved: boolean, degraded: boolean, hookDenied?: boolean, reason?: string }> {
  const { task, prepared, config } = input

  // 自动化 turn 无人值守，ask 降级为 block（D4）。
  if (task.snapshot.turnSource?.type === 'automation') {
    return {
      approved: false,
      degraded: true,
      reason: hookReason || `hook 要求人工确认，自动化任务不支持交互审批：${prepared.toolName}`,
    }
  }

  const pendingAction: AgentPendingAction = {
    actionId: randomUUID(),
    toolName: prepared.toolName,
    operationType: prepared.operationType,
    scope: prepared.scope,
    inputPreview: JSON.stringify(prepared.input).slice(0, 200),
    createdAt: Date.now(),
    ...(hookReason ? { hookReason } : {}),
  }

  // PermissionRequest hook：hook 触发的审批同样给其他 hook 一次拒绝机会。
  const permissionHook = await runPermissionRequestHook({
    config,
    task,
    toolName: prepared.toolName,
    toolInput: prepared.input,
    operationType: prepared.operationType,
    scope: prepared.scope,
    description: hookReason || 'hook 要求人工确认',
  })
  if (permissionHook.denied) {
    return { approved: false, degraded: false, hookDenied: true, reason: permissionHook.reason }
  }

  emitNotificationHook({
    config,
    conversationId: task.snapshot.conversationId,
    workspacePath: task.snapshot.workspacePath,
    type: 'approval_required',
    payload: {
      actionId: pendingAction.actionId,
      toolName: prepared.toolName,
      operationType: prepared.operationType,
      scope: prepared.scope,
      source: 'pre-tool-use-ask',
    },
  })

  const decision = await taskStore.requestApproval(task, pendingAction, config.eventEmitter)
  if (task.abortController.signal.aborted || decision.reason === 'AGENT_CANCELLED') {
    throw new AgentError('AGENT_CANCELLED', '任务已取消')
  }
  return { approved: decision.approved, degraded: false, reason: decision.reason }
}
