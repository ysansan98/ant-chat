import type { MessageCursor, MessageSearchCursor, MessageSearchPage, MessageSearchPort, MessageSearchView, MessageThreadPage, MessageTurn } from '@ant-chat/shared'
import type { AppDataDatabase } from './types'

/**
 * Agent 专用消息搜索后端（search/getThread/getTurn）。
 *
 * 搜索基于派生投影（message_search_documents + standalone FTS5），
 * 不触碰 messages.content JSON；FTS 能力在 migration 中探测，
 * 不支持时显式降级为 LIKE（记录在 message_search_meta）。
 *
 * 查询策略：
 * - CJK 连续 ≥3 字符 → trigram FTS（精确短语）；
 * - 1–2 CJK → 投影表 LIKE（转义 % _ \）；
 * - 其余（英文、标识符、路径）→ unicode61 FTS；
 * - 用户输入一律按字面 phrase 构造，禁止拼为 FTS 表达式。
 */

type SearchStrategy = 'trigram' | 'like' | 'unicode'

interface SearchHitRow {
  messageId: string
  conversationId: string
  conversationTitle: string
  ordinal: number
  role: string
  status: string
  text: string
  toolText: string
  createdAt: number
  updatedAt: number
}

interface MessageRowView {
  messageId: string
  conversationId: string
  conversationTitle: string
  ordinal: number
  role: string
  status: string
  text: string
  toolText: string
  createdAt: number
  turnId: string | null
}

const PROJECTION_COLUMNS = `
  d.message_id AS messageId,
  d.conversation_id AS conversationId,
  IFNULL(c.title, '') AS conversationTitle,
  d.ordinal AS ordinal,
  d.role AS role,
  d.status AS status,
  d.text AS text,
  d.tool_text AS toolText,
  m.created_at AS createdAt,
  c.updated_at AS updatedAt
`

const PROJECTION_JOINS = `
  FROM message_search_documents d
  JOIN messages m ON m.id = d.message_id
  JOIN conversations c ON c.id = d.conversation_id
`

const THREAD_COLUMNS = `
  d.message_id AS messageId,
  d.conversation_id AS conversationId,
  IFNULL(c.title, '') AS conversationTitle,
  d.ordinal AS ordinal,
  d.role AS role,
  d.status AS status,
  d.text AS text,
  d.tool_text AS toolText,
  m.created_at AS createdAt,
  m.turn_id AS turnId
`

// 线程窗口（getThread）与 turn（getTurn）都基于投影：event 消息是压缩产物，不进入窗口
const THREAD_JOINS = PROJECTION_JOINS

// getTurn 的逐条消息视图：按 id 定位的单条消息，可能没有投影（如 event）
const MESSAGE_COLUMNS = `
  m.id AS messageId,
  m.conv_id AS conversationId,
  IFNULL(c.title, '') AS conversationTitle,
  m.ordinal AS ordinal,
  m.role AS role,
  m.status AS status,
  IFNULL(d.text, '') AS text,
  IFNULL(d.tool_text, '') AS toolText,
  m.created_at AS createdAt,
  m.turn_id AS turnId
`

const MESSAGE_JOINS = `
  FROM messages m
  JOIN conversations c ON c.id = m.conv_id
  LEFT JOIN message_search_documents d ON d.message_id = m.id
`

const MAX_LIMIT = 50
const MAX_RADIUS = 10
const MAX_WINDOW = 100

export class SqliteMessageSearch implements MessageSearchPort {
  private readonly fts5Available: boolean
  private readonly trigramAvailable: boolean

  constructor(private readonly db: AppDataDatabase) {
    const capability = this.readCapability()
    this.fts5Available = capability.fts5
    this.trigramAvailable = capability.ftsTrigram
  }

  async search(input: {
    query: string
    workspacePath?: string
    conversationId?: string
    limit?: number
    cursor?: MessageSearchCursor
    contextRadius?: number
    toolName?: string
    serverName?: string
  }): Promise<MessageSearchPage> {
    const query = input.query?.trim()
    if (!query) {
      throw new Error('搜索关键词不能为空')
    }
    const limit = clampInt(input.limit ?? 10, 1, MAX_LIMIT)
    const radius = clampInt(input.contextRadius ?? 0, 0, MAX_RADIUS)

    const strategy = resolveSearchStrategy(this.fts5Available, this.trigramAvailable, query)
    const params: unknown[] = []
    let where: string
    let from: string
    if (strategy === 'like') {
      const pattern = `%${escapeLikePattern(query)}%`
      where = '(d.text LIKE ? ESCAPE \'\\\' OR d.tool_text LIKE ? ESCAPE \'\\\')'
      params.push(pattern, pattern)
      from = PROJECTION_JOINS
    }
    else {
      const ftsTable = strategy === 'trigram' ? 'messages_fts_trigram' : 'messages_fts_unicode'
      // FTS5 的 MATCH 必须使用表名而非别名（join 场景下别名解析为列引用）
      where = `${ftsTable} MATCH ?`
      params.push(ftsPhrase(query))
      from = `
        FROM ${ftsTable} f
        JOIN message_search_documents d ON d.message_id = f.message_id
        JOIN messages m ON m.id = d.message_id
        JOIN conversations c ON c.id = d.conversation_id
      `
    }

    if (input.workspacePath) {
      where += ' AND c.workspace_path = ?'
      params.push(input.workspacePath)
    }
    if (input.conversationId) {
      where += ' AND d.conversation_id = ?'
      params.push(input.conversationId)
    }
    if (input.cursor) {
      const { updatedAt, conversationId, ordinal } = input.cursor
      where += ` AND (
        c.updated_at < ?
        OR (c.updated_at = ? AND d.conversation_id > ?)
        OR (c.updated_at = ? AND d.conversation_id = ? AND d.ordinal > ?)
      )`
      params.push(updatedAt, updatedAt, conversationId, updatedAt, conversationId, ordinal)
    }
    if (input.toolName || input.serverName) {
      // 结构化 tool 事实过滤：tool_name 不限定 kind（call/result 均命中）；
      // server_name 只存在于 kind='call' 的事实（result 行无 server_name）
      where += ` AND EXISTS (
        SELECT 1 FROM message_tool_facts t
        WHERE t.message_id = d.message_id`
      if (input.toolName) {
        where += ' AND t.tool_name = ?'
        params.push(input.toolName)
      }
      if (input.serverName) {
        where += ` AND t.kind = 'call' AND t.server_name = ?`
        params.push(input.serverName)
      }
      where += ')'
    }
    params.push(limit)

    const rows = this.db.prepare<unknown[], SearchHitRow>(`
      SELECT ${PROJECTION_COLUMNS}
      ${from}
      WHERE ${where}
      ORDER BY c.updated_at DESC, d.conversation_id ASC, d.ordinal ASC
      LIMIT ?
    `).all(...params)

    const hits = rows.map(toHitView)

    if (radius > 0 && rows.length > 0) {
      const byConversation = groupBy(rows, row => row.conversationId)
      for (const [conversationId, conversationHits] of byConversation) {
        const ordinals = conversationHits.map(row => row.ordinal)
        const windowRows = this.db.prepare<unknown[], SearchHitRow>(`
          SELECT ${PROJECTION_COLUMNS}
          ${PROJECTION_JOINS}
          WHERE d.conversation_id = ? AND d.ordinal BETWEEN ? AND ?
          ORDER BY d.ordinal ASC
        `).all(conversationId, Math.min(...ordinals) - radius, Math.max(...ordinals) + radius)
        const hitIds = new Set(conversationHits.map(row => row.messageId))
        for (const hit of hits) {
          if (hit.conversationId !== conversationId) {
            continue
          }
          hit.context = windowRows
            .filter(row => !hitIds.has(row.messageId))
            .map(toHitView)
        }
      }
    }

    const last = rows[rows.length - 1]
    return {
      hits,
      // 已取满一页才给游标；未满说明已到末尾
      cursor: last && rows.length === limit
        ? { updatedAt: last.updatedAt, conversationId: last.conversationId, ordinal: last.ordinal }
        : undefined,
    }
  }

  async getThread(input: {
    conversationId: string
    before?: number
    after?: number
    cursor?: MessageCursor
  }): Promise<MessageThreadPage> {
    const before = clampInt(input.before ?? 20, 0, MAX_WINDOW)
    const after = clampInt(input.after ?? 0, 0, MAX_WINDOW)
    if (before === 0 && after === 0) {
      return { messages: [] }
    }

    const anchorOrdinal = input.cursor?.ordinal
      ?? this.db.prepare<unknown[], { ordinal: number | null }>(`
        SELECT MAX(ordinal) AS ordinal FROM messages WHERE conv_id = ?
      `).get(input.conversationId)?.ordinal ?? null
    if (anchorOrdinal === null) {
      return { messages: [] }
    }

    const beforeRows = before > 0
      ? this.db.prepare<unknown[], MessageRowView>(`
          SELECT ${THREAD_COLUMNS}
          ${THREAD_JOINS}
          WHERE d.conversation_id = ? AND d.ordinal < ?
          ORDER BY d.ordinal DESC
          LIMIT ?
        `).all(input.conversationId, anchorOrdinal, before)
      : []
    const afterRows = after > 0
      ? this.db.prepare<unknown[], MessageRowView>(`
          SELECT ${THREAD_COLUMNS}
          ${THREAD_JOINS}
          WHERE d.conversation_id = ? AND d.ordinal > ?
          ORDER BY d.ordinal ASC
          LIMIT ?
        `).all(input.conversationId, anchorOrdinal, after)
      : []

    const messages = [...beforeRows.reverse(), ...afterRows].map(toThreadView)
    return {
      messages,
      anchorOrdinal,
      // 向前翻页游标：窗口最早一条消息的 ordinal
      cursor: messages.length > 0 ? { ordinal: messages[0].ordinal } : undefined,
    }
  }

  async getTurn(input: { messageId: string }): Promise<MessageTurn> {
    const target = this.db.prepare<unknown[], { id: string, conv_id: string, turn_id: string | null, ordinal: number }>(`
      SELECT id, conv_id, turn_id, ordinal FROM messages WHERE id = ?
    `).get(input.messageId)
    if (!target) {
      throw new Error('消息未找到')
    }
    const { turn_id: turnId } = target

    let userRoot: MessageRowView | undefined
    const sameTurnRows: MessageRowView[] = []
    if (turnId) {
      // 用户根消息：主流程里 turnId 就是启动该 turn 的 user 消息 ID，
      // 该消息自身的 turn_id 为空，需按 id 精确匹配
      userRoot = this.db.prepare<unknown[], MessageRowView>(`
        SELECT ${MESSAGE_COLUMNS}
        ${MESSAGE_JOINS}
        WHERE m.id = ? AND m.role = 'user'
      `).get(turnId)
      sameTurnRows.push(...this.db.prepare<unknown[], MessageRowView>(`
        SELECT ${MESSAGE_COLUMNS}
        ${MESSAGE_JOINS}
        WHERE (m.turn_id = ? OR m.id = ?) AND m.conv_id = ?
        ORDER BY m.ordinal ASC
      `).all(turnId, turnId, target.conv_id))
    }

    const messages: MessageSearchView[] = []
    const seen = new Set<string>()
    for (const row of [userRoot, ...sameTurnRows]) {
      if (!row || seen.has(row.messageId)) {
        continue
      }
      seen.add(row.messageId)
      messages.push(toThreadView(row))
    }
    if (messages.length === 0) {
      messages.push(await this.toSingleMessageView(target.id))
    }

    const anchorOrdinal = userRoot?.ordinal ?? target.ordinal
    const compactionBoundary = this.findCompactionBoundary(target.conv_id, anchorOrdinal)

    return {
      turnId: turnId ?? undefined,
      userMessage: userRoot ? toThreadView(userRoot) : undefined,
      messages,
      compactionBoundary,
    }
  }

  private async toSingleMessageView(messageId: string): Promise<MessageSearchView> {
    const row = this.db.prepare<unknown[], MessageRowView>(`
      SELECT ${MESSAGE_COLUMNS}
      ${MESSAGE_JOINS}
      WHERE m.id = ?
    `).get(messageId)
    if (!row) {
      throw new Error('消息未找到')
    }
    return toThreadView(row)
  }

  private findCompactionBoundary(conversationId: string, beforeOrdinal: number): MessageTurn['compactionBoundary'] {
    const row = this.db.prepare<unknown[], { id: string, compacted_through_message_id: string, created_at: number, content: string }>(`
      SELECT id, compacted_through_message_id, created_at, content
      FROM messages
      WHERE conv_id = ?
        AND event_type = 'compaction'
        AND compacted_through_message_id IS NOT NULL
        AND ordinal < ?
      ORDER BY ordinal DESC
      LIMIT 1
    `).get(conversationId, beforeOrdinal)
    if (!row) {
      return undefined
    }
    return {
      messageId: row.id,
      conversationId,
      compactedThroughMessageId: row.compacted_through_message_id,
      summaryText: extractCompactionSummary(row.content),
      createdAt: row.created_at,
    }
  }

  private readCapability(): { fts5: boolean, ftsTrigram: boolean } {
    try {
      const rows = this.db.prepare<unknown[], { key: string, value: string }>(`
        SELECT key, value FROM message_search_meta
      `).all()
      const values = new Map(rows.map(row => [row.key, row.value]))
      return {
        fts5: values.get('fts5') === '1',
        ftsTrigram: values.get('fts_trigram') === '1',
      }
    }
    catch {
      return { fts5: false, ftsTrigram: false }
    }
  }
}

/** CJK 连续 ≥3 字符走 trigram；1–2 CJK 走 LIKE；其余走 unicode61。 */
export function resolveSearchStrategy(fts5: boolean, trigram: boolean, query: string): SearchStrategy {
  if (!fts5) {
    return 'like'
  }
  const cjkRuns = query.match(/[\u3400-\u4DBF\u4E00-\u9FFF]+/g) ?? []
  if (cjkRuns.length === 0) {
    return 'unicode'
  }
  if (cjkRuns.some(run => [...run].length >= 3)) {
    return trigram ? 'trigram' : 'like'
  }
  return 'like'
}

/** 按字面 phrase 构造 FTS5 查询：内部双引号翻倍，用户输入不参与表达式拼接。 */
function ftsPhrase(query: string): string {
  return `"${query.replace(/"/g, '""')}"`
}

/** LIKE 模式转义：% _ \ 前缀反斜杠。 */
function escapeLikePattern(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min
  }
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

function toHitView(row: SearchHitRow): MessageSearchPage['hits'][number] {
  return {
    messageId: row.messageId,
    conversationId: row.conversationId,
    conversationTitle: row.conversationTitle,
    ordinal: row.ordinal,
    role: row.role,
    status: row.status,
    text: row.text,
    toolText: row.toolText,
    createdAt: row.createdAt,
  }
}

function toThreadView(row: MessageRowView): MessageSearchView {
  return {
    messageId: row.messageId,
    conversationId: row.conversationId,
    conversationTitle: row.conversationTitle,
    ordinal: row.ordinal,
    role: row.role,
    status: row.status,
    text: row.text,
    toolText: row.toolText,
    createdAt: row.createdAt,
    turnId: row.turnId ?? undefined,
  }
}

function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const result = new Map<K, T[]>()
  for (const item of items) {
    const group = result.get(key(item)) ?? []
    group.push(item)
    result.set(key(item), group)
  }
  return result
}

function extractCompactionSummary(content: string): string {
  try {
    const parsed = JSON.parse(content) as unknown
    if (!Array.isArray(parsed)) {
      return ''
    }
    for (const block of parsed) {
      if (block && typeof block === 'object' && (block as { type?: unknown }).type === 'text' && typeof (block as { text?: unknown }).text === 'string') {
        return (block as { text: string }).text
      }
    }
    return ''
  }
  catch {
    return ''
  }
}
