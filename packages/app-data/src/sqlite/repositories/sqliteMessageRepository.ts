import type { AddMessage, AIMessage, IMessage, MessageContent, UpdateMessageSchema } from '@ant-chat/shared'
import type { MessageRepository } from '../../repositories'
import type { MessageRow } from '../rows'
import type { AppDataDatabase } from '../types'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { nanoid } from 'nanoid'
import { decodeAttachmentData } from '../migrations/migrateAttachments'
import { mapMessageRow, stringifyJson } from '../rows'
import { SqliteConversationRepository } from './sqliteConversationRepository'

interface SqliteMessageRepositoryOptions {
  attachmentsRoot?: string
}

const MESSAGE_COLUMNS = `
  id,
  conv_id,
  role,
  content,
  created_at,
  status,
  reasoning_content,
  model_info,
  usage,
  turn_id,
  event_type
`

export class SqliteMessageRepository implements MessageRepository {
  private readonly conversations: SqliteConversationRepository

  constructor(
    private readonly db: AppDataDatabase,
    private readonly options: SqliteMessageRepositoryOptions = {},
  ) {
    this.conversations = new SqliteConversationRepository(db)
  }

  async listByConversation(conversationId: string): Promise<IMessage[]> {
    const data = this.db.prepare<unknown[], MessageRow>(`
      SELECT ${MESSAGE_COLUMNS}
      FROM messages
      WHERE conv_id = ?
    `).all(conversationId)

    return data.map(mapMessageRow)
  }

  async getById(id: string): Promise<IMessage> {
    const result = this.db.prepare<unknown[], MessageRow>(`
      SELECT ${MESSAGE_COLUMNS}
      FROM messages
      WHERE id = ?
    `).get(id)
    if (!result) {
      throw new Error('消息未找到')
    }

    return mapMessageRow(result)
  }

  async create(message: AddMessage): Promise<IMessage> {
    await this.conversations.getById(message.convId)

    const id = `msg-${nanoid()}`
    const content = this.persistAttachmentData(message.content)
    const result = this.db.prepare<unknown[], MessageRow>(`
      INSERT INTO messages (
        id,
        conv_id,
        role,
        content,
        created_at,
        status,
        reasoning_content,
        model_info,
        usage,
        turn_id,
        event_type
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING ${MESSAGE_COLUMNS}
    `).get(
      id,
      message.convId,
      message.role,
      stringifyJson(content),
      Date.now(),
      message.status,
      'reasoningContent' in message ? message.reasoningContent ?? null : null,
      'modelInfo' in message ? stringifyNullableJson(message.modelInfo) : null,
      'usage' in message ? stringifyNullableJson(message.usage) : null,
      'turnId' in message ? message.turnId ?? null : null,
      'eventType' in message ? message.eventType ?? null : null,
    )

    if (!result) {
      throw new Error('创建消息失败')
    }

    return mapMessageRow(result)
  }

  async createAssistant(conversationId: string, modelInfo: AIMessage['modelInfo'], turnId?: string): Promise<IMessage> {
    return this.create({
      convId: conversationId,
      content: [],
      role: 'assistant',
      status: 'loading',
      modelInfo,
      reasoningContent: '',
      turnId,
    } as Extract<AddMessage, { role: 'assistant' }>)
  }

  async update(message: UpdateMessageSchema): Promise<IMessage> {
    const fields: string[] = []
    const params: unknown[] = []

    if (message.convId !== undefined) {
      fields.push('conv_id = ?')
      params.push(message.convId)
    }
    if (message.role !== undefined) {
      fields.push('role = ?')
      params.push(message.role)
    }
    if (message.content !== undefined) {
      fields.push('content = ?')
      params.push(stringifyJson(this.persistAttachmentData(message.content)))
    }
    if (message.status !== undefined) {
      fields.push('status = ?')
      params.push(message.status)
    }
    if (message.reasoningContent !== undefined) {
      fields.push('reasoning_content = ?')
      params.push(message.reasoningContent)
    }
    if (message.modelInfo !== undefined) {
      fields.push('model_info = ?')
      params.push(stringifyNullableJson(message.modelInfo))
    }
    if (message.usage !== undefined) {
      fields.push('usage = ?')
      params.push(stringifyNullableJson(message.usage))
    }
    if (message.turnId !== undefined) {
      fields.push('turn_id = ?')
      params.push(message.turnId)
    }
    if (message.eventType !== undefined) {
      fields.push('event_type = ?')
      params.push(message.eventType)
    }

    if (fields.length === 0) {
      return this.getById(message.id)
    }

    const updateMessage = this.db.transaction(() => {
      const result = this.db.prepare<unknown[], MessageRow>(`
        UPDATE messages
        SET ${fields.join(', ')}
        WHERE id = ?
        RETURNING ${MESSAGE_COLUMNS}
      `).get(...params, message.id)

      if (!result) {
        throw new Error('消息未找到')
      }

      this.db.prepare(`
        UPDATE conversations
        SET updated_at = ?
        WHERE id = ?
      `).run(Date.now(), result.conv_id)

      return result
    })

    return mapMessageRow(updateMessage())
  }

  async delete(id: string): Promise<boolean> {
    this.db.prepare('DELETE FROM messages WHERE id = ?').run(id)
    return true
  }

  async batchDelete(ids: string[]): Promise<boolean> {
    const deleteMessages = this.db.transaction((messageIds: string[]) => {
      const statement = this.db.prepare('DELETE FROM messages WHERE id = ?')
      for (const id of messageIds) {
        statement.run(id)
      }
    })

    deleteMessages(ids)
    return true
  }

  async loadAttachmentData(fileId: string): Promise<string | null> {
    const filePath = this.getAttachmentFilePath(fileId)
    try {
      return readFileSync(filePath).toString('base64')
    }
    catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return null
      }
      throw error
    }
  }

  private persistAttachmentData(content: MessageContent): MessageContent {
    return content.map((block) => {
      if (
        block.type !== 'image-block'
        && block.type !== 'document'
        && block.type !== 'file'
      ) {
        return block
      }

      if (!block.data) {
        return block
      }

      if (block.source.type !== 'file_id') {
        throw new Error('Attachment content with inline data must use file_id source')
      }

      const filePath = this.getAttachmentFilePath(block.source.file_id)
      mkdirSync(path.dirname(filePath), { recursive: true })
      const bytes = decodeAttachmentData(block.data)
      writeFileSync(filePath, bytes)

      this.db.prepare(`
        INSERT OR REPLACE INTO attachments (id, name, media_type, size, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        block.source.file_id,
        block.type === 'file' ? block.filename ?? block.name ?? 'file' : block.name ?? block.type,
        block.media_type ?? 'application/octet-stream',
        block.size ?? bytes.byteLength,
        Date.now(),
      )

      const { data: _data, ...persistedBlock } = block
      return persistedBlock
    })
  }

  private getAttachmentFilePath(fileId: string): string {
    if (!this.options.attachmentsRoot) {
      throw new Error('attachmentsRoot is required for attachment file storage')
    }
    if (!/^[\w-]+$/.test(fileId)) {
      throw new Error(`Invalid attachment file id: ${fileId}`)
    }

    return path.join(this.options.attachmentsRoot, fileId)
  }
}

function stringifyNullableJson(value: unknown): string | null {
  return value === null || value === undefined ? null : stringifyJson(value)
}
