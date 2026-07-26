import type { AgentRuntimeConfig } from '@ant-chat/shared'
import type { RuntimeTask } from '../taskStore'
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
  step?: number
  toolCallId?: string
  parentSpanId?: string
}

export type BeforeToolExecuteResult
  = | { outcome: 'allow' }
    | { outcome: 'block', errorCode: string, reason: string, continueAgent?: boolean }

export type ToolAuthorization = (
  input: BeforeToolExecuteInput,
) => Promise<BeforeToolExecuteResult>
