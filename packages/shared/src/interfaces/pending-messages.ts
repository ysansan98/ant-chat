/** 待处理消息来源：输入框（sender）、可视化表单（visualization）、消息频道（channel）。 */
export type AppPendingMessageSource = 'sender' | 'visualization' | 'channel'

/**
 * 队列项对客户端公开的视图。
 *
 * 只包含展示与操作所需字段；接力执行所需的运行时元数据（模式、频道来源等）
 * 由后端存储在服务端，不随协议暴露。
 */
export interface AppPendingMessage {
  id: string
  conversationId: string
  text: string
  source: AppPendingMessageSource
  createdAt: number
}

/** 会话级队列快照：命令响应与变更事件共用同一载荷，便于客户端整体对账。 */
export interface AppPendingMessageSnapshot {
  conversationId: string
  /**
   * 快照版本号，会话内单调递增（runtime 进程内计数）。
   * 客户端用它丢弃乱序到达的旧快照；对账拉取（list）不受此限制。
   */
  revision: number
  messages: AppPendingMessage[]
}
