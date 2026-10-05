import type { AgentRuntimeConfig, HookAggregateResult, HookEvent } from '@ant-chat/shared'
import type { RuntimeTask } from '../taskStore'
import { recordHookObservation } from './observability'

/** hook 运行时只需要日志与 trace 记录能力，便于非 AgentRuntime 场景（如 manual compact）复用。 */
export type HookRuntimeConfig = Pick<AgentRuntimeConfig, 'hooks' | 'logger' | 'turnRecorder'>

export interface HookRunContext {
  config: HookRuntimeConfig
  /** 会话/任务标识；用于 hook 输入与日志。 */
  conversationId: string
  workspacePath: string
  signal?: AbortSignal
}

/**
 * 统一的安全调用：hooks 未配置返回 undefined；任何异常都按无决策处理。
 * 所有 hook 调用的失败隔离都收敛在这里，避免各挂点重复 try/catch。
 */
export async function runHookSafely(
  context: HookRunContext,
  event: HookEvent,
  extra: Record<string, unknown>,
  observationExtra: Record<string, unknown> = {},
): Promise<HookAggregateResult | undefined> {
  const hooks = context.config.hooks
  if (!hooks)
    return undefined
  try {
    const result = await hooks.run(event, {
      hook_event_name: event,
      session_id: context.conversationId,
      conversation_id: context.conversationId,
      cwd: context.workspacePath,
      timestamp: Date.now(),
      ...extra,
    }, {
      cwd: context.workspacePath,
      signal: context.signal,
    })
    recordHookObservation(context.config, event, result, observationExtra)
    return result
  }
  catch (error) {
    context.config.logger?.warn(`${event} hook 执行失败，已忽略`, error)
    return undefined
  }
}

/**
 * PermissionRequest（P1）：审批卡片弹出前给 hook 一次拒绝机会。
 * v1 只支持 deny（自动拒绝、不弹审批）；不支持 allow 自动放行。
 */
export async function runPermissionRequestHook(params: {
  config: HookRuntimeConfig
  task: RuntimeTask
  toolName: string
  toolInput: Record<string, unknown>
  operationType: string
  scope: string
  description: string
  step?: number
  toolCallId?: string
}): Promise<{ denied: boolean, reason?: string }> {
  const result = await runHookSafely({
    config: params.config,
    conversationId: params.task.snapshot.conversationId,
    workspacePath: params.task.snapshot.workspacePath,
    signal: params.task.abortController.signal,
  }, 'PermissionRequest', {
    tool_name: params.toolName,
    tool_input: params.toolInput,
    operation_type: params.operationType,
    scope: params.scope,
    description: params.description,
    step: params.step,
    tool_call_id: params.toolCallId,
  }, { tool_name: params.toolName, tool_call_id: params.toolCallId })

  if (result?.decision === 'deny') {
    return {
      denied: true,
      reason: result.reason || `hook 自动拒绝了 ${params.toolName} 的审批请求`,
    }
  }
  return { denied: false }
}

/** PreCompact（P1）：deny 或 continue:false 阻止压缩。 */
export async function runPreCompactHook(params: {
  config: HookRuntimeConfig
  conversationId: string
  workspacePath: string
  trigger: 'manual' | 'automatic'
  signal?: AbortSignal
}): Promise<{ allowed: boolean, reason?: string }> {
  const result = await runHookSafely({
    config: params.config,
    conversationId: params.conversationId,
    workspacePath: params.workspacePath,
    signal: params.signal,
  }, 'PreCompact', { trigger: params.trigger }, { trigger: params.trigger })

  if (result && (result.decision === 'deny' || result.continue === false)) {
    return { allowed: false, reason: result.reason || 'hook 阻止了上下文压缩' }
  }
  return { allowed: true }
}

/** PostCompact（P1）：压缩事务完成后的观察点。 */
export async function runPostCompactHook(params: {
  config: HookRuntimeConfig
  conversationId: string
  workspacePath: string
  trigger: 'manual' | 'automatic'
  status: string
  summaryText?: string
  signal?: AbortSignal
}): Promise<void> {
  await runHookSafely({
    config: params.config,
    conversationId: params.conversationId,
    workspacePath: params.workspacePath,
    signal: params.signal,
  }, 'PostCompact', {
    trigger: params.trigger,
    status: params.status,
    summary_text: params.summaryText,
  }, { trigger: params.trigger, status: params.status })
}

/** Interrupt（P1）：观察类，输出不可阻止中断；fire-and-forget。 */
export function emitInterruptHook(params: {
  config: HookRuntimeConfig
  conversationId: string
  workspacePath: string
  turnId?: string
  reason: 'user_cancel' | 'loop_cancelled'
}): void {
  void runHookSafely({
    config: params.config,
    conversationId: params.conversationId,
    workspacePath: params.workspacePath,
  }, 'Interrupt', {
    turn_id: params.turnId,
    reason: params.reason,
  }, { turn_id: params.turnId, reason: params.reason })
}

/** Notification（P1）：审批请求与回合结束的观察点；fire-and-forget。 */
export function emitNotificationHook(params: {
  config: HookRuntimeConfig
  conversationId: string
  workspacePath: string
  type: 'approval_required' | 'turn_finished'
  payload: Record<string, unknown>
}): void {
  void runHookSafely({
    config: params.config,
    conversationId: params.conversationId,
    workspacePath: params.workspacePath,
  }, 'Notification', {
    type: params.type,
    payload: params.payload,
  }, { type: params.type })
}
