import type { AgentRuntimeConfig, ILogger } from '@ant-chat/shared'

export const agentCoreLogger: ILogger = {
  error: () => {},
  info: () => {},
  warn: () => {},
}

export function getAgentLogger(config: Pick<AgentRuntimeConfig, 'logger'>): ILogger {
  return config.logger ?? agentCoreLogger
}
