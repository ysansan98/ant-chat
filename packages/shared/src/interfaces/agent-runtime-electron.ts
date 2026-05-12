import type { AgentMode } from './agent-runtime'
import type { ChatFeatures, IAttachment, IConversations } from './db-types'
import type { ChatSettings } from './model-service'

/**
 * Electron 应用层的 agent turn 启动参数（依赖 DB/Electron 特定类型）
 * 放在 shared 中作为协议约定，agent-runtime package 不引用此类型
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
  chatSettings: Omit<ChatSettings, 'model' | 'features'> & {
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
