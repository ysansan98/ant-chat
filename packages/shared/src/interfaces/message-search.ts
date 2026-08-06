/**
 * Agent 专用消息搜索后端接口（agent tool 后端，不替换前端 SqliteMessageSearchQuery）。
 *
 * 搜索基于可重建的派生读模型（message_search_documents + FTS），
 * 不直接扫描 messages.content JSON。
 */

/** 投影视图中的一条消息（来自 message_search_documents 等派生表）。 */
export interface MessageSearchView {
  messageId: string
  conversationId: string
  conversationTitle: string
  ordinal: number
  role: string
  status: string
  text: string
  toolText: string
  createdAt: number
  turnId?: string
}

/** 搜索分页游标：按 (会话更新时间, 会话ID, ordinal) 的 keyset 定位。 */
export interface MessageSearchCursor {
  updatedAt: number
  conversationId: string
  ordinal: number
}

/** 单条命中：contextRadius > 0 时附带同会话相邻窗口消息。 */
export interface MessageSearchHit extends MessageSearchView {
  context?: MessageSearchView[]
}

export interface MessageSearchPage {
  hits: MessageSearchHit[]
  cursor?: MessageSearchCursor
}

/** getThread 锚点：会话内的稳定 ordinal。 */
export interface MessageCursor {
  ordinal: number
}

export interface MessageThreadPage {
  messages: MessageSearchView[]
  /** 本次查询使用的锚点 ordinal（缺省时为会话最后一条消息）。 */
  anchorOrdinal?: number
  /** 向前翻页游标：返回窗口最早一条消息的 ordinal；无消息时为 undefined。 */
  cursor?: MessageCursor
}

/** Compaction boundary：与被查消息所在 turn 关联的压缩事件。 */
export interface MessageCompactionBoundary {
  messageId: string
  conversationId: string
  compactedThroughMessageId: string
  summaryText: string
  createdAt: number
}

/**
 * V1 的 getTurn 语义：本 turn 的用户根消息 + 同 turn 消息 + 关联 compaction boundary。
 * 当前 schema 没有 parent_id/显式因果边，不伪造分支追溯。
 */
export interface MessageTurn {
  turnId?: string
  userMessage?: MessageSearchView
  /** 同 turn 消息（含用户根消息与 steering 消息），按 ordinal 升序。 */
  messages: MessageSearchView[]
  compactionBoundary?: MessageCompactionBoundary
}

export interface MessageSearchPort {
  search: (input: {
    query: string
    workspacePath?: string
    conversationId?: string
    limit?: number
    cursor?: MessageSearchCursor
    contextRadius?: number
    /** 按工具名精确过滤（匹配 message_tool_facts.tool_name，call/result 均命中）。 */
    toolName?: string
    /** 按 MCP server 名精确过滤（仅匹配 kind='call' 的事实；result 无 server_name）。 */
    serverName?: string
  }) => Promise<MessageSearchPage>

  getThread: (input: {
    conversationId: string
    before?: number
    after?: number
    cursor?: MessageCursor
  }) => Promise<MessageThreadPage>

  getTurn: (input: { messageId: string }) => Promise<MessageTurn>
}
