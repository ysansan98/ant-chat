import type { AgentErrorCode } from '@ant-chat/shared'

export class AgentError extends Error {
  public readonly code: AgentErrorCode

  constructor(code: AgentErrorCode, message: string) {
    super(message)
    this.name = 'AgentError'
    this.code = code
    Object.setPrototypeOf(this, AgentError.prototype)
  }
}
