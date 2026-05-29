import type { AgentMode } from './agent-runtime'
import type { ChatFeatures, IAttachment, IConversations } from './db-types'
import type { ChatSettings } from './model-service'

/**
 * App transport input for starting an agent turn.
 */
export interface StartAgentTurnOptions {
  conversationId?: string
  prompt: string
  images?: IAttachment[]
  attachments?: IAttachment[]
  referencedFiles?: string[]
  selectedSkill?: string
  workspacePath?: string
  mode?: AgentMode
  modelConfig: Omit<ChatSettings, 'model' | 'features'> & {
    modelId: string
    features: ChatFeatures
  }
}

export interface AgentTurnResult {
  taskId: string
  conversationId: string
  userMessageId: string
  conversation: IConversations
}
