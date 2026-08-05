import type { ReasoningEffortLevel } from '../schemas/providerConfigModels'
import type { AgentMode, AgentTurnSource } from './agent-runtime'
import type { IConversations, IMessageContent } from './db-types'

/**
 * App transport input for starting an agent turn.
 */
export interface StartAgentTurnOptions {
  /** 频道入站重试时复用已持久化的初始 user Message。 */
  userMessageId?: string
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
    reasoningEffort?: ReasoningEffortLevel
  }
}

export interface AgentTurnResult {
  taskId: string
  conversationId: string
  userMessageId: string
  conversation: IConversations
}
