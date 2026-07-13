import type { ReasoningEffortLevel } from '../schemas/providerConfigModels'
import type { AgentMode, AgentTurnSource } from './agent-runtime'
import type { IConversations, IMessageContent } from './db-types'

/**
 * App transport input for starting an agent turn.
 */
export interface StartAgentTurnOptions {
  conversationId?: string
  messageContent: IMessageContent
  turnSource?: AgentTurnSource
  workspacePath: string
  mode?: AgentMode
  /** 仅新建 conversation 时消费 */
  conversationInstructions?: string
  modelConfig: {
    modelId: string
    providerId: string
    temperature?: number
    maxOutputTokens?: number
    reasoningEffort?: ReasoningEffortLevel
  }
}

export interface AgentTurnResult {
  taskId: string
  conversationId: string
  userMessageId: string
  conversation: IConversations
}
