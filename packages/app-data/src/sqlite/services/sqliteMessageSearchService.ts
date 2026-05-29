import type { MessageContent, SearchResult } from '@ant-chat/shared'
import type { AppDataDatabase } from '../types'
import { parseMessageContent } from '../rows'

interface SearchMessageRow {
  id: string
  conversationId: string
  conversationTitle: string
  content: string
  createdAt: number
  convCreatedAt: number
}

export class SqliteMessageSearchService {
  constructor(private readonly db: AppDataDatabase) {}

  async searchMessagesByKeyword(query: string): Promise<SearchResult[]> {
    const searchQuery = `%${query}%`
    const results = this.db.prepare<unknown[], SearchMessageRow>(`
      SELECT
        m.id AS id,
        m.conv_id AS conversationId,
        IFNULL(c.title, '') AS conversationTitle,
        m.content AS content,
        m.created_at AS createdAt,
        c.created_at AS convCreatedAt
      FROM messages m
      LEFT JOIN conversations c ON m.conv_id = c.id
      WHERE EXISTS (
        SELECT 1
        FROM json_each(m.content) AS item
        WHERE json_extract(item.value, '$.type') = 'text'
          AND json_extract(item.value, '$.text') LIKE ?
      )
      ORDER BY c.created_at DESC, m.created_at DESC
    `).all(searchQuery)

    return groupSearchResults(results, query)
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
        content: extractSnippet(contentToSearchText(parseMessageContent(item.content)), query),
        createdAt: item.createdAt,
      })),
      conversationTitle: first.conversationTitle,
      createdAt: first.convCreatedAt,
    })
  }

  return result
}

function contentToSearchText(content: MessageContent): string {
  return content.reduce((acc, item) => {
    if (item.type === 'text') {
      return acc + item.text
    }
    if (item.type === 'error') {
      return acc + item.error
    }
    return acc
  }, '')
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
