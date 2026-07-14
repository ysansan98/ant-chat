import type { AddMessage, AIMessage, IMessage, MessageContent, UpdateMessageSchema } from '@ant-chat/shared'
import type { MessageRepository } from '../../repositories'
import type { MessageRow } from '../rows'
import type { AppDataDatabase } from '../types'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { nanoid } from 'nanoid'
import { getAttachmentFileCandidates, getAttachmentFilePath } from '../attachmentFiles'
import { decodeAttachmentData } from '../migrations/migrateAttachments'
import { mapMessageRow, stringifyJson } from '../rows'
import { SqliteConversationRepository } from './sqliteConversationRepository'

interface StagedAttachment {
  fileId: string
  tempPath: string
  finalPath: string
  name: string
  mediaType: string
  size: number
}

/** 临时承接 shared visualization schema 合入前的持久化形状。 */
interface VisualizationBlock {
  type: 'visualization'
  source: { type: 'file_id', file_id: string }
  format: 'ant-chat.visualization.v1'
  title: string
  summary: string
  size: number
  sha256: string
  data?: string
}

type PersistedMessageContent = Array<MessageContent[number] | VisualizationBlock>

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

    return data.map(mapPersistedMessageRow)
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

    return mapPersistedMessageRow(result)
  }

  async create(message: AddMessage, options?: { id?: string }): Promise<IMessage> {
    await this.conversations.getById(message.convId)

    const id = options?.id ?? `msg-${nanoid()}`
    const stagedFiles: StagedAttachment[] = []
    const committedFiles = new Set<string>()
    try {
      const content = this.stageAttachmentData(message.content, stagedFiles)

      const createMessage = this.db.transaction(() => {
        this.commitStagedAttachments(stagedFiles, true)
        for (const staged of stagedFiles) {
          committedFiles.add(staged.fileId)
        }
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

      return mapPersistedMessageRow(result)
    }
    catch (error) {
      this.cleanupStagedFiles(stagedFiles, committedFiles)
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
    const existing = await this.getById(message.id)
    const previousFileIds = message.content === undefined
      ? []
      : getAttachmentIdsFromContent(existing.content)

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
    const stagedFiles: StagedAttachment[] = []
    const committedFiles = new Set<string>()
    let removedFileIds: string[] = []
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
      return existing
    }

    try {
      let content: PersistedMessageContent | undefined
      if (message.content !== undefined) {
        content = this.stageAttachmentData(message.content, stagedFiles)
      }

      const updateMessage = this.db.transaction(() => {
        this.commitStagedAttachments(stagedFiles, true)
        for (const staged of stagedFiles) {
          committedFiles.add(staged.fileId)
        }

        const transactionParams = [...params]
        if (content !== undefined) {
          transactionParams.splice(fields.findIndex(field => field === 'content = ?'), 0, stringifyJson(content))
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

        if (content !== undefined) {
          const nextFileIds = getAttachmentIdsFromContent(content)
          removedFileIds = previousFileIds.filter(fileId => !nextFileIds.includes(fileId))
          const unreferencedFileIds = this.findUnreferencedAttachmentFileIds(removedFileIds, [message.id])
          this.deleteAttachmentRows(unreferencedFileIds)
          removedFileIds = unreferencedFileIds
        }

        this.db.prepare(`
          UPDATE conversations
          SET updated_at = ?
          WHERE id = ?
        `).run(Date.now(), result.conv_id)

        return result
      })

      const updated = updateMessage()
      if (!updated) {
        throw new Error('消息未找到')
      }
      this.removeAttachmentFiles(removedFileIds)
      return mapPersistedMessageRow(updated)
    }
    catch (error) {
      this.cleanupStagedFiles(stagedFiles, committedFiles)
      throw error
    }
  }

  async delete(id: string): Promise<boolean> {
    const fileIds = this.getMessageAttachmentFileIds([id])
    let filesToRemove: string[] = []
    const deleteMessage = this.db.transaction(() => {
      this.db.prepare('DELETE FROM messages WHERE id = ?').run(id)
      filesToRemove = this.findUnreferencedAttachmentFileIds(fileIds, [id])
      this.deleteAttachmentRows(filesToRemove)
    })

    deleteMessage()
    this.removeAttachmentFiles(filesToRemove)
    return true
  }

  async batchDelete(ids: string[]): Promise<boolean> {
    const fileIds = this.getMessageAttachmentFileIds(ids)
    let filesToRemove: string[] = []
    const deleteMessages = this.db.transaction((messageIds: string[]) => {
      const statement = this.db.prepare('DELETE FROM messages WHERE id = ?')
      for (const id of messageIds) {
        statement.run(id)
      }
      filesToRemove = this.findUnreferencedAttachmentFileIds(fileIds, ids)
      this.deleteAttachmentRows(filesToRemove)
    })

    deleteMessages(ids)
    this.removeAttachmentFiles(filesToRemove)
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

  async loadVisualizationData(input: { conversationId: string, messageId: string, fileId: string }): Promise<string | null> {
    let message: IMessage
    try {
      message = await this.getById(input.messageId)
    }
    catch {
      return null
    }
    if (message.convId !== input.conversationId) {
      return null
    }

    const block = getVisualizationBlocks(message.content).find(item => item.source.file_id === input.fileId)
    if (!block) {
      return null
    }

    let data: string | null
    try {
      data = await this.loadAttachmentData(input.fileId)
    }
    catch {
      return null
    }
    if (!data) {
      return null
    }
    const digest = createHash('sha256').update(Buffer.from(data, 'base64')).digest('hex')
    return digest === block.sha256 ? data : null
  }

  prepareConversationAttachmentCleanup(conversationId: string): () => void {
    const ids = this.db.prepare<unknown[], { id: string }>(`
      SELECT id FROM messages WHERE conv_id = ?
    `).all(conversationId).map(row => row.id)
    const fileIds = this.getMessageAttachmentFileIds(ids)

    const filesToRemove = this.findUnreferencedAttachmentFileIds(fileIds, ids)
    this.deleteAttachmentRows(filesToRemove)
    return () => this.removeAttachmentFiles(filesToRemove)
  }

  private stageAttachmentData(content: MessageContent, stagedFiles: StagedAttachment[]): PersistedMessageContent {
    return (content as unknown as PersistedMessageContent).map((block) => {
      if (block.type === 'tool-call' && block.outputBlocks) {
        const { outputBlocks: _outputBlocks, ...safeToolCall } = block
        return safeToolCall
      }
      if (block.type === 'visualization') {
        if (!block.data) {
          return block
        }
        const attachmentsRoot = this.requireAttachmentsRoot()
        const finalPath = getAttachmentFilePath(attachmentsRoot, block.source.file_id)
        const tempPath = `${finalPath}.staging-${nanoid()}`
        mkdirSync(path.dirname(finalPath), { recursive: true })
        const bytes = decodeAttachmentData(block.data)
        writeFileSync(tempPath, bytes)
        stagedFiles.push({
          fileId: block.source.file_id,
          tempPath,
          finalPath,
          name: block.title,
          mediaType: 'application/json',
          size: bytes.byteLength,
        })
        const { data: _data, ...persistedBlock } = block
        return persistedBlock
      }
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

      const attachmentsRoot = this.requireAttachmentsRoot()
      const finalPath = getAttachmentFilePath(attachmentsRoot, block.source.file_id)
      const tempPath = `${finalPath}.staging-${nanoid()}`
      mkdirSync(path.dirname(finalPath), { recursive: true })
      const bytes = decodeAttachmentData(block.data)
      writeFileSync(tempPath, bytes)

      stagedFiles.push({
        fileId: block.source.file_id,
        tempPath,
        finalPath,
        name: block.type === 'file' ? block.filename ?? block.name ?? 'file' : block.name ?? block.type,
        mediaType: block.media_type ?? 'application/octet-stream',
        size: block.size ?? bytes.byteLength,
      })

      const { data: _data, ...persistedBlock } = block
      return persistedBlock
    })
  }

  private commitStagedAttachments(stagedFiles: StagedAttachment[], skipExisting = false): void {
    for (const staged of stagedFiles) {
      const existing = this.db.prepare<unknown[], { id: string }>('SELECT id FROM attachments WHERE id = ?').get(staged.fileId)
      if (existing) {
        if (skipExisting) {
          // 附件已存在时跳过写入，清理临时文件，保留旧数据
          try {
            rmSync(staged.tempPath, { force: true })
          }
          catch {}
          continue
        }
        throw new Error(`附件 ID 已存在: ${staged.fileId}`)
      }

      renameSync(staged.tempPath, staged.finalPath)

      this.db.prepare(`
        INSERT INTO attachments (id, name, media_type, size, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        staged.fileId,
        staged.name,
        staged.mediaType,
        staged.size,
        Date.now(),
      )
    }
  }

  private cleanupStagedFiles(stagedFiles: StagedAttachment[], committedFiles: Set<string>): void {
    for (const staged of stagedFiles) {
      try {
        rmSync(staged.tempPath, { force: true })
      }
      catch {
        // 临时文件可能已被 rename 移除
      }
      if (committedFiles.has(staged.fileId)) {
        rmSync(staged.finalPath, { force: true })
      }
    }
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
      for (const fileId of getAttachmentIdsFromContent(parsePersistedContent(row.content))) {
        ids.add(fileId)
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

  private findUnreferencedAttachmentFileIds(fileIds: string[], excludedMessageIds: string[] = []): string[] {
    if (fileIds.length === 0) {
      return []
    }
    const excluded = new Set(excludedMessageIds)
    const referenced = new Set<string>()
    const rows = this.db.prepare<unknown[], { id: string, content: string }>('SELECT id, content FROM messages').all()
    for (const row of rows) {
      if (excluded.has(row.id)) {
        continue
      }
      for (const fileId of getAttachmentIdsFromContent(parsePersistedContent(row.content))) {
        referenced.add(fileId)
      }
    }
    return fileIds.filter(fileId => !referenced.has(fileId))
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

function stringifyNullableJson(value: unknown): string | null {
  return value === null || value === undefined ? null : stringifyJson(value)
}

function mapPersistedMessageRow(row: MessageRow): IMessage {
  const content = parsePersistedContent(row.content)
  if (!content.some(block => block.type === 'visualization')) {
    return mapMessageRow(row)
  }
  const compatibleRow = {
    ...row,
    content: stringifyJson(content.filter(block => block.type !== 'visualization')),
  }
  return {
    ...mapMessageRow(compatibleRow),
    content: content as unknown as IMessage['content'],
  }
}

function parsePersistedContent(value: string): PersistedMessageContent {
  const content = JSON.parse(value)
  if (!Array.isArray(content)) {
    throw new TypeError('消息内容格式无效')
  }
  return content as PersistedMessageContent
}

function getAttachmentIdsFromContent(content: unknown): string[] {
  if (!Array.isArray(content)) {
    return []
  }
  const ids = new Set<string>()
  for (const block of content) {
    if (!block || typeof block !== 'object' || Array.isArray(block)) {
      continue
    }
    const candidate = block as {
      type?: unknown
      source?: { type?: unknown, file_id?: unknown }
    }
    if (
      (candidate.type === 'image-block' || candidate.type === 'document' || candidate.type === 'file' || candidate.type === 'visualization')
      && candidate.source?.type === 'file_id'
      && typeof candidate.source.file_id === 'string'
    ) {
      ids.add(candidate.source.file_id)
    }
  }
  return [...ids]
}

function getVisualizationBlocks(content: unknown): VisualizationBlock[] {
  if (!Array.isArray(content)) {
    return []
  }
  return content.filter((block): block is VisualizationBlock => {
    if (!block || typeof block !== 'object' || Array.isArray(block)) {
      return false
    }
    const candidate = block as Partial<VisualizationBlock>
    return candidate.type === 'visualization'
      && candidate.format === 'ant-chat.visualization.v1'
      && Boolean(candidate.source && candidate.source.type === 'file_id')
      && typeof candidate.sha256 === 'string'
  })
}
