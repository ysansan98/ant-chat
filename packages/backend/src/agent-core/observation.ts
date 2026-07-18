import type { AgentObservationSpan, AgentRuntimeConfig, AgentTurnRecorder } from '@ant-chat/shared'

export function startObservationSpan(
  config: Pick<AgentRuntimeConfig, 'logger' | 'turnRecorder'>,
  start: (recorder: AgentTurnRecorder) => AgentObservationSpan,
): AgentObservationSpan | undefined {
  if (!config.turnRecorder)
    return undefined
  try {
    return start(config.turnRecorder)
  }
  catch (error) {
    config.logger?.warn('Agent Observability 记录失败', error)
    return undefined
  }
}

export function completeObservation(span: AgentObservationSpan | undefined, output?: unknown, logger?: AgentRuntimeConfig['logger']): void {
  observe(() => span?.complete(output), logger)
}

export function failObservation(span: AgentObservationSpan | undefined, error: unknown, logger?: AgentRuntimeConfig['logger']): void {
  observe(() => span?.fail(error), logger)
}

export function cancelObservation(span: AgentObservationSpan | undefined, reason: unknown, logger?: AgentRuntimeConfig['logger']): void {
  observe(() => span?.cancel(reason), logger)
}

export function recordContextObservation(config: Pick<AgentRuntimeConfig, 'logger' | 'turnRecorder'>, event: unknown): void {
  observe(() => config.turnRecorder?.recordContextEvent(event), config.logger)
}

export function finishTurnObservation(
  config: Pick<AgentRuntimeConfig, 'logger' | 'turnRecorder'>,
  result: Parameters<AgentTurnRecorder['finish']>[0],
): void {
  observe(() => config.turnRecorder?.finish(result), config.logger)
}

function observe(operation: () => void, logger?: AgentRuntimeConfig['logger']): void {
  try {
    operation()
  }
  catch (error) {
    logger?.warn('Agent Observability 记录失败', error)
  }
}
