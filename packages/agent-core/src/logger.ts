import type { AgentRuntimeConfig, ILogger } from '@ant-chat/shared'

export const agentCoreLogger: ILogger = {
  info: (msg, ...args) => console.info(msg, ...args),
  warn: (msg, ...args) => console.warn(msg, ...args),
  error: (msg, ...args) => console.error(msg, ...args),
}

export function getAgentLogger(config: Pick<AgentRuntimeConfig, 'logger'>): ILogger {
  return config.logger ?? agentCoreLogger
}
