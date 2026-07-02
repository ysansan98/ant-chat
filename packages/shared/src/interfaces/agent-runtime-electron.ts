import type { AgentMode, AgentTurnSource } from './agent-runtime'
import type { ChatFeatures, IConversations, IMessageContent } from './db-types'
import type { ModelSettings } from './model-service'

/**
 * App transport input for starting an agent turn.
 */
export interface StartAgentTurnOptions {
  conversationId?: string
  prompt: string
  content?: IMessageContent
  referencedFiles?: string[]
  selectedSkill?: string
  selectedSkills?: string[]
  turnSource?: AgentTurnSource
  workspacePath: string
  mode?: AgentMode
  modelConfig: Omit<ModelSettings, 'model' | 'features'> & {
    modelId: string
    providerId: string
    features: ChatFeatures
  }
}

export interface AgentTurnResult {
  taskId: string
  conversationId: string
  userMessageId: string
  conversation: IConversations
}
