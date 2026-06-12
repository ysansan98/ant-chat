import type { AddMessage, AIMessage, IMessage, MessageContent, UpdateMessageSchema } from '@ant-chat/shared'
import type { MessageRepository } from '../../repositories'
import type { MessageRow } from '../rows'
import type { AppDataDatabase } from '../types'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { nanoid } from 'nanoid'
import { getAttachmentFileCandidates, getAttachmentFilePath } from '../attachmentFiles'
import { decodeAttachmentData } from '../migrations/migrateAttachments'
import { mapMessageRow, parseMessageContent, stringifyJson } from '../rows'
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
  event_type,
  compacted_through_message_id,
  duration_ms
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
      ORDER BY created_at ASC, rowid ASC
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

  async create(message: AddMessage, options?: { id?: string }): Promise<IMessage> {
    await this.conversations.getById(message.convId)

    const id = options?.id ?? `msg-${nanoid()}`
    const writtenFiles: string[] = []
    try {
      const createMessage = this.db.transaction(() => {
        const content = this.persistAttachmentData(message.content, writtenFiles)
        return this.db.prepare<unknown[], MessageRow>(`
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
            event_type,
            compacted_through_message_id,
            duration_ms
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          'compactedThroughMessageId' in message ? message.compactedThroughMessageId ?? null : null,
          null,
        )
      })

      const result = createMessage()
      if (!result) {
        throw new Error('创建消息失败')
      }

      return mapMessageRow(result)
    }
    catch (error) {
      cleanupWrittenFiles(writtenFiles)
      throw error
    }
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
    const writtenFiles: string[] = []
    if (message.content !== undefined)
      fields.push('content = ?')
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
    if (message.compactedThroughMessageId !== undefined) {
      fields.push('compacted_through_message_id = ?')
      params.push(message.compactedThroughMessageId)
    }
    if (message.durationMs !== undefined) {
      fields.push('duration_ms = ?')
      params.push(message.durationMs)
    }

    if (fields.length === 0) {
      return this.getById(message.id)
    }

    const updateMessage = this.db.transaction(() => {
      const transactionParams = [...params]
      if (message.content !== undefined) {
        transactionParams.splice(fields.findIndex(field => field === 'content = ?'), 0, stringifyJson(this.persistAttachmentData(message.content, writtenFiles)))
      }

      const result = this.db.prepare<unknown[], MessageRow>(`
        UPDATE messages
        SET ${fields.join(', ')}
        WHERE id = ?
        RETURNING ${MESSAGE_COLUMNS}
      `).get(...transactionParams, message.id)

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

    try {
      return mapMessageRow(updateMessage())
    }
    catch (error) {
      cleanupWrittenFiles(writtenFiles)
      throw error
    }
  }

  async delete(id: string): Promise<boolean> {
    const fileIds = this.getMessageAttachmentFileIds([id])
    const deleteMessage = this.db.transaction(() => {
      this.db.prepare('DELETE FROM messages WHERE id = ?').run(id)
      this.deleteAttachmentRows(fileIds)
    })

    deleteMessage()
    this.removeAttachmentFiles(fileIds)
    return true
  }

  async batchDelete(ids: string[]): Promise<boolean> {
    const fileIds = this.getMessageAttachmentFileIds(ids)
    const deleteMessages = this.db.transaction((messageIds: string[]) => {
      const statement = this.db.prepare('DELETE FROM messages WHERE id = ?')
      for (const id of messageIds) {
        statement.run(id)
      }
      this.deleteAttachmentRows(fileIds)
    })

    deleteMessages(ids)
    this.removeAttachmentFiles(fileIds)
    return true
  }

  async loadAttachmentData(fileId: string): Promise<string | null> {
    for (const filePath of this.getAttachmentFileCandidates(fileId)) {
      try {
        return readFileSync(filePath).toString('base64')
      }
      catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
          continue
        }
        throw error
      }
    }
    return null
  }

  prepareConversationAttachmentCleanup(conversationId: string): () => void {
    const ids = this.db.prepare<unknown[], { id: string }>(`
      SELECT id FROM messages WHERE conv_id = ?
    `).all(conversationId).map(row => row.id)
    const fileIds = this.getMessageAttachmentFileIds(ids)

    this.deleteAttachmentRows(fileIds)
    return () => this.removeAttachmentFiles(fileIds)
  }

  private persistAttachmentData(content: MessageContent, writtenFiles: string[]): MessageContent {
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

      const filePath = getAttachmentFilePath(this.requireAttachmentsRoot(), block.source.file_id)
      mkdirSync(path.dirname(filePath), { recursive: true })
      const bytes = decodeAttachmentData(block.data)
      writeFileSync(filePath, bytes)
      writtenFiles.push(filePath)

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

  private getMessageAttachmentFileIds(messageIds: string[]): string[] {
    if (messageIds.length === 0) {
      return []
    }

    const placeholders = messageIds.map(() => '?').join(', ')
    const rows = this.db.prepare<unknown[], { content: string }>(`
      SELECT content FROM messages WHERE id IN (${placeholders})
    `).all(...messageIds)
    const ids = new Set<string>()
    for (const row of rows) {
      for (const block of parseMessageContent(row.content)) {
        if (
          (block.type === 'image-block' || block.type === 'document' || block.type === 'file')
          && block.source.type === 'file_id'
        ) {
          ids.add(block.source.file_id)
        }
      }
    }

    return [...ids]
  }

  private deleteAttachmentRows(fileIds: string[]): void {
    const statement = this.db.prepare('DELETE FROM attachments WHERE id = ?')
    for (const fileId of fileIds) {
      statement.run(fileId)
    }
  }

  private removeAttachmentFiles(fileIds: string[]): void {
    for (const fileId of fileIds) {
      for (const filePath of this.getAttachmentFileCandidates(fileId)) {
        rmSync(filePath, { force: true })
      }
    }
  }

  private getAttachmentFileCandidates(fileId: string): string[] {
    return getAttachmentFileCandidates(this.requireAttachmentsRoot(), fileId)
  }

  private requireAttachmentsRoot(): string {
    if (!this.options.attachmentsRoot) {
      throw new Error('attachmentsRoot is required for attachment file storage')
    }
    return this.options.attachmentsRoot
  }
}

function cleanupWrittenFiles(filePaths: string[]): void {
  for (const filePath of filePaths) {
    rmSync(filePath, { force: true })
  }
}

function stringifyNullableJson(value: unknown): string | null {
  return value === null || value === undefined ? null : stringifyJson(value)
}
