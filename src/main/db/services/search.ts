import type { SearchResult } from '@ant-chat/shared'
import { eq, sql } from 'drizzle-orm'
import { db } from '../db'
import { conversationsTable, messagesTable } from '../schema'

export async function searchMessagesByKeyword(query: string): Promise<SearchResult[]> {
  const searchQuery = `%${query}%`

  const results = await db
    .select({
      id: messagesTable.id,
      conversationId: messagesTable.convId,
      conversationTitle: sql`IFNULL(${conversationsTable.title}, '')`,
      content: messagesTable.content,
      createdAt: messagesTable.createdAt,
      convCreatedAt: conversationsTable.createdAt,
    })
    .from(messagesTable)
    .leftJoin(conversationsTable, eq(messagesTable.convId, conversationsTable.id))
    .where(
      sql`
       EXISTS (
        SELECT 1 
        FROM JSON_EACH(${messagesTable.content}) AS item
        WHERE JSON_EXTRACT(item.value, '$.type') = 'text'
        AND JSON_EXTRACT(item.value, '$.text') LIKE ${searchQuery}
      )
      `,
    )
    .orderBy(sql` ${conversationsTable.createdAt} DESC, ${messagesTable.createdAt} DESC`)

  const groupedResults = Object.groupBy(results, item => item.conversationId)

  const result: SearchResult[] = []

  for (const key in groupedResults) {
    const list = groupedResults[key]

    if (!list || list.length === 0)
      continue

    const messages = list.map(item => ({
      id: item.id,
      content: extractSnippet(
        item.content.reduce(
          (acc, content) => {
            if (content.type === 'image') {
              return acc
            }
            else if (content.type === 'text') {
              return acc + content.text
            }
            return acc + content.error
          },
          '',
        ),
        query,
      ),
      createdAt: item.createdAt,
    }))

    result.push({
      id: key,
      type: 'message',
      conversationId: list[0].conversationId,
      messages,
      conversationTitle: list[0].conversationTitle as string,
      createdAt: list[0].convCreatedAt!,
    })
  }

  return result
}

function extractSnippet(text: string, keyword: string, contextLength = 50): string {
  if (!text || !keyword)
    return ''

  // 如果文本很短，直接返回
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

  // 添加省略号
  if (start > 0)
    snippet = `...${snippet}`
  if (end < text.length)
    snippet = `${snippet}...`

  return snippet
}
