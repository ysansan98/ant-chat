import type { AgentRuntimeConfig, HookAggregateResult, HookEvent } from '@ant-chat/shared'
import { recordContextObservation } from '../observation'

/** 把一次 hook run 记入 observation，便于 observability 面板排查。 */
export function recordHookObservation(
  config: Pick<AgentRuntimeConfig, 'logger' | 'turnRecorder'>,
  event: HookEvent,
  result: HookAggregateResult,
  extra: Record<string, unknown> = {},
): void {
  recordContextObservation(config, {
    kind: 'hook',
    hook_event_name: event,
    ...extra,
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
}
