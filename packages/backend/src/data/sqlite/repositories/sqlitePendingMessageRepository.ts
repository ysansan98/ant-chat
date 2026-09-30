import type { AgentMode, AgentTurnSource, AppPendingMessageSource } from '@ant-chat/shared'
import type { PendingMessageRecord, PendingMessageRepository } from '../../repositories/pendingMessageRepository'
import type { AppDataDatabase } from '../types'

interface PendingMessageRow {
  id: string
  conversation_id: string
  text: string
  source: AppPendingMessageSource
  mode: AgentMode | null
  user_message_id: string | null
  turn_source: string | null
  created_at: number
}

const PENDING_MESSAGE_COLUMNS = 'id, conversation_id, text, source, mode, user_message_id, turn_source, created_at'

export class SqlitePendingMessageRepository implements PendingMessageRepository {
  constructor(private readonly db: AppDataDatabase) {}

  async listByConversation(conversationId: string) {
    const rows = this.db.prepare<[string], PendingMessageRow>(
      `SELECT ${PENDING_MESSAGE_COLUMNS} FROM pending_messages WHERE conversation_id = ? ORDER BY created_at, id`,
    ).all(conversationId)
    return rows.map(mapPendingMessage)
  }

  async get(conversationId: string, id: string) {
    const row = this.db.prepare<[string, string], PendingMessageRow>(
      `SELECT ${PENDING_MESSAGE_COLUMNS} FROM pending_messages WHERE conversation_id = ? AND id = ?`,
    ).get(conversationId, id)
    return row ? mapPendingMessage(row) : undefined
  }

  async create(record: PendingMessageRecord) {
    this.db.prepare(`INSERT INTO pending_messages (${PENDING_MESSAGE_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      record.id,
      record.conversationId,
      record.text,
      record.source,
      record.mode ?? null,
      record.userMessageId ?? null,
      record.turnSource ? JSON.stringify(record.turnSource) : null,
      record.createdAt,
    )
    return (await this.get(record.conversationId, record.id))!
  }

  async updateText(conversationId: string, id: string, text: string) {
    const result = this.db.prepare('UPDATE pending_messages SET text = ? WHERE conversation_id = ? AND id = ?').run(text, conversationId, id)
    if (result.changes === 0)
      return undefined
    return await this.get(conversationId, id)
  }

  async delete(conversationId: string, id: string) {
    const result = this.db.prepare('DELETE FROM pending_messages WHERE conversation_id = ? AND id = ?').run(conversationId, id)
    return result.changes > 0
  }
}

function mapPendingMessage(row: PendingMessageRow): PendingMessageRecord {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    text: row.text,
    source: row.source,
    ...(row.mode ? { mode: row.mode } : {}),
    ...(row.user_message_id ? { userMessageId: row.user_message_id } : {}),
    ...(row.turn_source ? { turnSource: JSON.parse(row.turn_source) as AgentTurnSource } : {}),
    createdAt: row.created_at,
  }
}
