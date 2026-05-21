import type { AgentRuntimeConfig } from '@ant-chat/shared'
import type { RuntimeTask } from './taskStore'
import type { PreparedToolCall } from './toolRegistry'

export interface ToolCallContext {
  toolName: string
  input: Record<string, unknown>
  operationType: string
  scope: string
  policy: string
}

export interface BeforeToolExecuteInput {
  task: RuntimeTask
  prepared: PreparedToolCall
  config: AgentRuntimeConfig
  onToolCallContext?: (context: ToolCallContext) => void
}

export type BeforeToolExecuteResult
  = | { outcome: 'allow' }
    | { outcome: 'block', errorCode: string, reason: string }

export type BeforeToolExecuteHook = (
  input: BeforeToolExecuteInput,
) => Promise<BeforeToolExecuteResult>
