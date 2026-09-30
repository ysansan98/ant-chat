import type { AgentMode, AgentTurnSource, AppPendingMessageSource } from '@ant-chat/shared'

/**
 * 待处理消息的持久化记录。
 *
 * text / source / createdAt 面向客户端展示；mode、userMessageId、turnSource 是
 * 接力执行所需的运行时元数据，客户端不可见。
 */
export interface PendingMessageRecord {
  id: string
  conversationId: string
  text: string
  source: AppPendingMessageSource
  /** 入队时用户选择的权限模式，接力按此模式启动任务。 */
  mode?: AgentMode
  /** 已持久化的 user message（频道场景入队即落库），接力时复用而非新建。 */
  userMessageId?: string
  /** 频道等非交互来源的轮次元数据，接力时透传给 startTurn。 */
  turnSource?: AgentTurnSource
  createdAt: number
}

export interface PendingMessageRepository {
  listByConversation: (conversationId: string) => Promise<PendingMessageRecord[]>
  get: (conversationId: string, id: string) => Promise<PendingMessageRecord | undefined>
  create: (record: PendingMessageRecord) => Promise<PendingMessageRecord>
  /** 编辑文本；记录不存在时返回 undefined。 */
  updateText: (conversationId: string, id: string, text: string) => Promise<PendingMessageRecord | undefined>
  /** 删除；返回是否删除了记录。 */
  delete: (conversationId: string, id: string) => Promise<boolean>
}
