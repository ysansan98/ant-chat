import type { SearchResult } from '@ant-chat/shared'
import type { AppDataDatabase } from '../types'
import { escapeLikePattern, ftsPhrase } from '../sqliteMessageSearch'

interface SearchMessageRow {
  id: string
  conversationId: string
  conversationTitle: string
  text: string
  createdAt: number
  convCreatedAt: number
}

interface SearchCapability {
  fts5: boolean
  trigram: boolean
}

/**
 * 用户全局消息搜索：只查搜索投影/FTS，不再解析 messages.content JSON。
 *
 * - 匹配范围是 message_search_documents.text（text/error/批注等用户可读文本），
 *   不含 tool_text；
 * - FTS 不可用或表缺失时降级为投影表 LIKE，仍避免 json_each 全表扫描；
 * - 分组与排序保持原合同：会话按 created_at DESC，组内消息按 created_at DESC。
 */
export class SqliteMessageSearchQuery {
  private readonly capability: SearchCapability

  constructor(private readonly db: AppDataDatabase) {
    this.capability = readCapability(db)
  }

  async searchMessagesByKeyword(query: string): Promise<SearchResult[]> {
    // 空查询没有可检索 token，返回空结果而不是退化成匹配全部消息
    const keyword = query?.trim() ?? ''
    if (!keyword) {
      return []
    }

    // 用户全局搜索保持旧 LIKE 的子串语义：≥3 个字符走 trigram（支持子串），
    // 更短的查询无法命中 trigram 索引，回退到投影表 LIKE。
    const useTrigram = this.capability.fts5 && this.capability.trigram && [...keyword].length >= 3
    const rows = useTrigram
      ? this.searchTrigram(keyword)
      : this.searchProjection(keyword)

    return groupSearchResults(rows, keyword)
  }

  private searchProjection(keyword: string): SearchMessageRow[] {
    return this.db.prepare<unknown[], SearchMessageRow>(`
      SELECT
        m.id AS id,
        d.conversation_id AS conversationId,
        IFNULL(c.title, '') AS conversationTitle,
        d.text AS text,
        m.created_at AS createdAt,
        c.created_at AS convCreatedAt
      FROM message_search_documents d
      JOIN messages m ON m.id = d.message_id
      LEFT JOIN conversations c ON c.id = d.conversation_id
      WHERE d.text LIKE ? ESCAPE '\\'
      ORDER BY c.created_at DESC, m.created_at DESC
    `).all(`%${escapeLikePattern(keyword)}%`)
  }

  private searchTrigram(keyword: string): SearchMessageRow[] {
    // 列限定符是固定常量，用户输入整体作为已转义的 phrase 参数；
    // 限定 text 列可避免 tool_text 命中改变用户搜索的匹配范围。
    const matchExpression = `text : ${ftsPhrase(keyword)}`

    return this.db.prepare<unknown[], SearchMessageRow>(`
      SELECT
        m.id AS id,
        m.conv_id AS conversationId,
        IFNULL(c.title, '') AS conversationTitle,
        f.text AS text,
        m.created_at AS createdAt,
        c.created_at AS convCreatedAt
      FROM messages_fts_trigram f
      JOIN messages m ON m.id = f.message_id
      LEFT JOIN conversations c ON c.id = m.conv_id
      WHERE messages_fts_trigram MATCH ?
      ORDER BY c.created_at DESC, m.created_at DESC
    `).all(matchExpression)
  }
}

/** 能力以 message_search_meta 为准，并校验 FTS 表真实存在（防止标记与表不一致）。 */
function readCapability(db: AppDataDatabase): SearchCapability {
  try {
    const values = new Map(
      db.prepare<unknown[], { key: string, value: string }>(`
        SELECT key, value FROM message_search_meta
      `).all().map(row => [row.key, row.value]),
    )
    const tables = new Set(
      db.prepare<unknown[], { name: string }>(`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name IN ('messages_fts_unicode', 'messages_fts_trigram')
      `).all().map(row => row.name),
    )
    return {
      fts5: values.get('fts5') === '1' && tables.has('messages_fts_unicode'),
      trigram: values.get('fts_trigram') === '1' && tables.has('messages_fts_trigram'),
    }
  }
  catch {
    // 能力表不存在（例如未跑 migration 的测试库）：整体降级为投影 LIKE
    return { fts5: false, trigram: false }
  }
}

function groupSearchResults(rows: SearchMessageRow[], query: string): SearchResult[] {
  const groupedResults = new Map<string, SearchMessageRow[]>()

  for (const row of rows) {
    const group = groupedResults.get(row.conversationId) ?? []
    group.push(row)
    groupedResults.set(row.conversationId, group)
  }

  const result: SearchResult[] = []
  for (const [conversationId, list] of groupedResults) {
    const first = list[0]
    result.push({
      id: conversationId,
      type: 'message',
      conversationId,
      messages: list.map(item => ({
        id: item.id,
        content: extractSnippet(item.text, query),
        createdAt: item.createdAt,
      })),
      conversationTitle: first.conversationTitle,
      createdAt: first.convCreatedAt,
    })
  }

  return result
}

function extractSnippet(text: string, keyword: string, contextLength = 50): string {
  if (!text || !keyword)
    return ''

  if (text.length <= contextLength * 2) {
    return text
  }

  const lowerText = text.toLowerCase()
  const lowerKeyword = keyword.toLowerCase()
  const keywordIndex = lowerText.indexOf(lowerKeyword)

  if (keywordIndex === -1)
    return `${text.substring(0, contextLength * 2)}...`

  const start = Math.max(0, keywordIndex - contextLength)
  const end = Math.min(text.length, keywordIndex + keyword.length + contextLength)

  let snippet = text.substring(start, end)

  if (start > 0)
    snippet = `...${snippet}`
  if (end < text.length)
    snippet = `${snippet}...`

  return snippet
}
