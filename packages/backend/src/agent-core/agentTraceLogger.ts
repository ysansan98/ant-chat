import type { AgentRuntimeConfig } from '@ant-chat/shared'

export class AgentTraceLogger {
  constructor(private readonly config: Pick<AgentRuntimeConfig, 'taskLogger'>) {}

  write(event: string, payload: Record<string, unknown>): void {
    this.config.taskLogger?.write(event, payload)
  }

  close(): void {
    this.config.taskLogger?.close()
  }
}

export function createAgentTraceLogger(config: Pick<AgentRuntimeConfig, 'taskLogger'>): AgentTraceLogger {
  return new AgentTraceLogger(config)
}
