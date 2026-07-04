import type { Database } from 'better-sqlite3'
import { Buffer } from 'node:buffer'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAttachmentFilePath } from '../../attachmentFiles'
import { initializeAppDataSchema } from '../../schema'
import { SqliteMessageSearchQuery } from '../../queries'
import { mapConversationRow } from '../../rows'
import { SqliteConversationRepository } from '../sqliteConversationRepository'
import { SqliteMessageRepository } from '../sqliteMessageRepository'

describe('sqlite message repository', () => {
  it('lists conversation messages by creation time and insertion order', async () => {
    let preparedSql = ''
    const all = vi.fn(() => [])
    const prepare = vi.fn((sql: string) => {
      preparedSql = sql
      return { all }
    })
    const repository = new SqliteMessageRepository({
      prepare,
    } as never)

    await repository.listByConversation('conv-1')

    expect(prepare).toHaveBeenCalledOnce()
    expect(preparedSql.replace(/\s+/g, ' ').trim())
      .toContain('WHERE conv_id = ? ORDER BY created_at ASC, rowid ASC')
    expect(all).toHaveBeenCalledWith('conv-1')
  })
})

describe('sqlite row mapping', () => {
  it('migrates legacy keepRecentPairs settings to the default token target', () => {
    const conversation = mapConversationRow({
      id: 'conv-1',
      workspace_path: '/workspace',
      title: 'Legacy compaction settings',
      created_at: 1,
      updated_at: 1,
      settings: JSON.stringify({
        modelId: 'model-1',
        systemPrompt: '',
        temperature: 0.7,
        maxTokens: 4096,
        compaction: {
          enabled: true,
          thresholdPercent: 70,
          keepRecentPairs: 3,
        },
      }),
    })

    expect(conversation.settings.compaction).toEqual({
      enabled: true,
      thresholdPercent: 70,
      keepRecentTokens: 20_000,
    })
  })
})

describe('sqlite repositories', () => {
  let sqlite: Database
  let attachmentsRoot: string

  beforeEach(() => {
    const BetterSqlite = loadBetterSqlite()
    sqlite = new BetterSqlite(':memory:')
    initializeAppDataSchema(sqlite)
    attachmentsRoot = mkdtempSync(path.join(tmpdir(), 'ant-chat-repository-attachments-'))
  })

  afterEach(() => {
    sqlite.close()
    rmSync(attachmentsRoot, { force: true, recursive: true })
  })

  it('creates conversations and paginates messages', async () => {
    const conversationRepository = new SqliteConversationRepository(sqlite)
    const messageRepository = new SqliteMessageRepository(sqlite, { attachmentsRoot })

    const conversation = await conversationRepository.create({
      title: 'Test',
      workspacePath: '/workspace',
      createdAt: 1,
      updatedAt: 1,
      settings: {
        modelId: 'model-1',
        providerId: '',
        systemPrompt: '',
        temperature: 0.7,
        maxTokens: 1024,
      },
    })
    const message = await messageRepository.create({
      convId: conversation.id,
      role: 'user',
      status: 'success',
      content: [{ type: 'text', text: 'hello' }],
    })

    const messages = await messageRepository.listByConversation(conversation.id)

    expect(message.convId).toBe(conversation.id)
    expect(message.content).toEqual([{ type: 'text', text: 'hello' }])
    expect(messages).toEqual([expect.objectContaining({ id: message.id, convId: conversation.id })])
  })

  it('归档后从普通列表隐藏，并可按工作区搜索和恢复', async () => {
    const repository = new SqliteConversationRepository(sqlite)
    const older = await repository.create({ title: '旧的设计讨论', workspacePath: '/ws-a', createdAt: 1, updatedAt: 1, settings: { modelId: 'm', providerId: '', systemPrompt: '', temperature: 0.7, maxTokens: 1024 } })
    const newer = await repository.create({ title: '归档设计讨论', workspacePath: '/ws-a', createdAt: 2, updatedAt: 2, settings: { modelId: 'm', providerId: '', systemPrompt: '', temperature: 0.7, maxTokens: 1024 } })
    await repository.create({ title: '其他工作区', workspacePath: '/ws-b', createdAt: 3, updatedAt: 3, settings: { modelId: 'm', providerId: '', systemPrompt: '', temperature: 0.7, maxTokens: 1024 } })

    await repository.setArchived(older.id, true)
    await repository.setArchived(newer.id, true)

    await expect(repository.list(0, 20, '/ws-a')).resolves.toEqual({ data: [], total: 0 })
    await expect(repository.listArchivedWorkspaces('设计')).resolves.toEqual([{ workspacePath: '/ws-a', total: 2 }])
    const archived = await repository.listArchived(0, 1, '/ws-a', '归档')
    expect(archived).toEqual({ data: [expect.objectContaining({ id: newer.id, archived: true })], total: 1 })

    const restored = await repository.setArchived(older.id, false)
    expect(restored).toMatchObject({ id: older.id, archived: false, updatedAt: 1 })
    await expect(repository.list(0, 20, '/ws-a')).resolves.toEqual({ data: [restored], total: 1 })
  })

  it('永久删除已归档会话时不会删除未归档会话', async () => {
    const repository = new SqliteConversationRepository(sqlite)
    const archived = await repository.create({ title: '归档', workspacePath: '/ws-a', createdAt: 1, updatedAt: 1, settings: { modelId: 'm', providerId: '', systemPrompt: '', temperature: 0.7, maxTokens: 1024 } })
    const visible = await repository.create({ title: '保留', workspacePath: '/ws-a', createdAt: 2, updatedAt: 2, settings: { modelId: 'm', providerId: '', systemPrompt: '', temperature: 0.7, maxTokens: 1024 } })
    await repository.setArchived(archived.id, true)

    await expect(repository.deleteArchivedByWorkspace('/ws-a')).resolves.toEqual([archived.id])
    await expect(repository.getById(visible.id)).resolves.toMatchObject({ id: visible.id, archived: false })
  })

  it('uses a caller-provided message id', async () => {
    const conversationRepository = new SqliteConversationRepository(sqlite)
    const messageRepository = new SqliteMessageRepository(sqlite, { attachmentsRoot })
    const conversation = await conversationRepository.create({
      title: 'Steering',
      workspacePath: '/workspace',
      createdAt: 1,
      updatedAt: 1,
      settings: {
        modelId: 'model-1',
        providerId: '',
        systemPrompt: '',
        temperature: 0.7,
        maxTokens: 1024,
      },
    })

    const message = await messageRepository.create({
      convId: conversation.id,
      role: 'user',
      status: 'success',
      content: [{ type: 'text', text: 'steering' }],
    }, { id: 'msg-steering-1' })

    expect(message.id).toBe('msg-steering-1')
    await expect(messageRepository.getById('msg-steering-1')).resolves.toEqual(message)
  })

  it('persists compaction boundary, model info, and usage on event messages', async () => {
    const conversationRepository = new SqliteConversationRepository(sqlite)
    const messageRepository = new SqliteMessageRepository(sqlite, { attachmentsRoot })
    const conversation = await conversationRepository.create({
      title: 'Compaction',
      workspacePath: '/workspace',
      createdAt: 1,
      updatedAt: 1,
      settings: {
        modelId: 'model-1',
        providerId: '',
        systemPrompt: '',
        temperature: 0.7,
        maxTokens: 1024,
      },
    })

    const event = await messageRepository.create({
      convId: conversation.id,
      role: 'event',
      status: 'success',
      eventType: 'compaction',
      content: [{ type: 'text', text: 'summary' }],
      compactedThroughMessageId: 'message-boundary',
      modelInfo: {
        provider: 'provider',
        providerId: 'provider-1',
        model: 'model-1',
      },
      usage: {
        inputTokens: 9000,
        outputTokens: 300,
        totalTokens: 9300,
      },
    })

    expect(event).toEqual(expect.objectContaining({
      compactedThroughMessageId: 'message-boundary',
      modelInfo: {
        provider: 'provider',
        providerId: 'provider-1',
        model: 'model-1',
      },
      usage: {
        inputTokens: 9000,
        outputTokens: 300,
        totalTokens: 9300,
      },
    }))
  })

  it('searches text messages by keyword grouped by conversation', async () => {
    const conversationRepository = new SqliteConversationRepository(sqlite)
    const messageRepository = new SqliteMessageRepository(sqlite, { attachmentsRoot })
    const searchService = new SqliteMessageSearchQuery(sqlite)

    const olderConversation = await conversationRepository.create({
      title: 'Older',
      workspacePath: '/workspace',
      createdAt: 1,
      updatedAt: 1,
      settings: {
        modelId: 'model-1',
        providerId: '',
        systemPrompt: '',
        temperature: 0.7,
        maxTokens: 1024,
      },
    })
    const newerConversation = await conversationRepository.create({
      title: 'Newer',
      workspacePath: '/workspace',
      createdAt: 2,
      updatedAt: 2,
      settings: {
        modelId: 'model-1',
        providerId: '',
        systemPrompt: '',
        temperature: 0.7,
        maxTokens: 1024,
      },
    })

    await messageRepository.create({
      convId: olderConversation.id,
      role: 'user',
      status: 'success',
      content: [{ type: 'text', text: 'needle in older conversation' }],
    })
    await messageRepository.create({
      convId: newerConversation.id,
      role: 'user',
      status: 'success',
      content: [{ type: 'image', mimeType: 'image/png', data: 'base64' }],
    })
    const matchedMessage = await messageRepository.create({
      convId: newerConversation.id,
      role: 'user',
      status: 'success',
      content: [{ type: 'text', text: 'newer conversation has needle' }],
    })

    const results = await searchService.searchMessagesByKeyword('needle')

    expect(results).toEqual([
      {
        id: newerConversation.id,
        type: 'message',
        conversationId: newerConversation.id,
        conversationTitle: 'Newer',
        createdAt: 2,
        messages: [
          {
            id: matchedMessage.id,
            content: 'newer conversation has needle',
            createdAt: matchedMessage.createdAt,
          },
        ],
      },
      {
        id: olderConversation.id,
        type: 'message',
        conversationId: olderConversation.id,
        conversationTitle: 'Older',
        createdAt: 1,
        messages: [
          expect.objectContaining({
            content: 'needle in older conversation',
          }),
        ],
      },
    ])
  })

  it('persists inline attachment data and stores file references in message content', async () => {
    const conversationRepository = new SqliteConversationRepository(sqlite)
    const messageRepository = new SqliteMessageRepository(sqlite, { attachmentsRoot })
    const bytes = Buffer.from([0x89, 0x50, 0x4E, 0x47])

    const conversation = await conversationRepository.create({
      title: 'Attachments',
      workspacePath: '/workspace',
      createdAt: 1,
      updatedAt: 1,
      settings: {
        modelId: 'model-1',
        providerId: '',
        systemPrompt: '',
        temperature: 0.7,
        maxTokens: 1024,
      },
    })

    const message = await messageRepository.create({
      convId: conversation.id,
      role: 'user',
      status: 'success',
      content: [
        { type: 'text', text: 'see image' },
        {
          type: 'image-block',
          source: { type: 'file_id', file_id: 'img-1' },
          name: 'image.png',
          media_type: 'image/png',
          size: bytes.length,
          data: `data:image/png;base64,${bytes.toString('base64')}`,
        },
      ],
    })

    expect(message.content).toEqual([
      { type: 'text', text: 'see image' },
      {
        type: 'image-block',
        source: { type: 'file_id', file_id: 'img-1' },
        name: 'image.png',
        media_type: 'image/png',
        size: bytes.length,
      },
    ])
    expect(readFileSync(getAttachmentFilePath(attachmentsRoot, 'img-1'))).toEqual(bytes)
    await expect(messageRepository.loadAttachmentData('img-1')).resolves.toBe(bytes.toString('base64'))
  })

  it('removes attachment files when messages and conversations are deleted', async () => {
    const messageRepository = new SqliteMessageRepository(sqlite, { attachmentsRoot })
    const conversationRepository = new SqliteConversationRepository(sqlite, {
      prepareConversationAttachmentCleanup: messageRepository.prepareConversationAttachmentCleanup.bind(messageRepository),
    })
    const bytes = Buffer.from('file content', 'utf8')

    const conversation = await conversationRepository.create({
      title: 'Cleanup',
      workspacePath: '/workspace',
      createdAt: 1,
      updatedAt: 1,
      settings: {
        modelId: 'model-1',
        providerId: '',
        systemPrompt: '',
        temperature: 0.7,
        maxTokens: 1024,
      },
    })

    const first = await messageRepository.create({
      convId: conversation.id,
      role: 'user',
      status: 'success',
      content: [
        { type: 'text', text: 'first' },
        {
          type: 'document',
          source: { type: 'file_id', file_id: 'doc-1' },
          name: 'doc.txt',
          media_type: 'text/plain',
          size: bytes.length,
          data: bytes.toString('base64'),
        },
      ],
    })
    await messageRepository.create({
      convId: conversation.id,
      role: 'user',
      status: 'success',
      content: [
        { type: 'text', text: 'second' },
        {
          type: 'file',
          source: { type: 'file_id', file_id: 'file-1' },
          filename: 'archive.zip',
          media_type: 'application/zip',
          size: bytes.length,
          data: bytes.toString('base64'),
        },
      ],
    })

    expect(readFileSync(getAttachmentFilePath(attachmentsRoot, 'doc-1'))).toEqual(bytes)
    expect(readFileSync(getAttachmentFilePath(attachmentsRoot, 'file-1'))).toEqual(bytes)

    await messageRepository.delete(first.id)
    await expect(messageRepository.loadAttachmentData('doc-1')).resolves.toBeNull()
    expect(readFileSync(getAttachmentFilePath(attachmentsRoot, 'file-1'))).toEqual(bytes)

    await conversationRepository.delete(conversation.id)
    await expect(messageRepository.loadAttachmentData('file-1')).resolves.toBeNull()
  })

  it('deletes all conversations in target workspace via deleteByWorkspace', async () => {
    const conversationRepository = new SqliteConversationRepository(sqlite)

    await conversationRepository.create({ title: 'Target 1', workspacePath: '/ws-a', createdAt: 1, updatedAt: 1, settings: { modelId: 'm', providerId: '', systemPrompt: '', temperature: 0.7, maxTokens: 1024 } })
    await conversationRepository.create({ title: 'Target 2', workspacePath: '/ws-a', createdAt: 2, updatedAt: 2, settings: { modelId: 'm', providerId: '', systemPrompt: '', temperature: 0.7, maxTokens: 1024 } })
    await conversationRepository.create({ title: 'Other', workspacePath: '/ws-b', createdAt: 3, updatedAt: 3, settings: { modelId: 'm', providerId: '', systemPrompt: '', temperature: 0.7, maxTokens: 1024 } })

    const deletedIds = await conversationRepository.deleteByWorkspace('/ws-a')

    expect(deletedIds).toHaveLength(2)
    const remaining = await conversationRepository.list(0, 100, '/ws-b')
    expect(remaining.data).toHaveLength(1)
    expect(remaining.data[0].title).toBe('Other')
  })

  it('includes null workspace conversations when includeNullWorkspace is true', async () => {
    const conversationRepository = new SqliteConversationRepository(sqlite)

    await conversationRepository.create({ title: 'Named', workspacePath: '/ws-a', createdAt: 1, updatedAt: 1, settings: { modelId: 'm', providerId: '', systemPrompt: '', temperature: 0.7, maxTokens: 1024 } })
    await conversationRepository.create({ title: 'Default', workspacePath: undefined, createdAt: 2, updatedAt: 2, settings: { modelId: 'm', providerId: '', systemPrompt: '', temperature: 0.7, maxTokens: 1024 } })
    await conversationRepository.create({ title: 'Other', workspacePath: '/ws-b', createdAt: 3, updatedAt: 3, settings: { modelId: 'm', providerId: '', systemPrompt: '', temperature: 0.7, maxTokens: 1024 } })

    const deletedIds = await conversationRepository.deleteByWorkspace('/ws-a', true)

    expect(deletedIds).toHaveLength(2)
    const remaining = await conversationRepository.list(0, 100)
    expect(remaining.data).toHaveLength(1)
    expect(remaining.data[0].title).toBe('Other')
  })

  it('preserves conversations in other workspaces', async () => {
    const conversationRepository = new SqliteConversationRepository(sqlite)

    await conversationRepository.create({ title: 'A', workspacePath: '/ws-a', createdAt: 1, updatedAt: 1, settings: { modelId: 'm', providerId: '', systemPrompt: '', temperature: 0.7, maxTokens: 1024 } })
    await conversationRepository.create({ title: 'B', workspacePath: '/ws-b', createdAt: 2, updatedAt: 2, settings: { modelId: 'm', providerId: '', systemPrompt: '', temperature: 0.7, maxTokens: 1024 } })

    await conversationRepository.deleteByWorkspace('/ws-a')

    const bList = await conversationRepository.list(0, 100, '/ws-b')
    expect(bList.data).toHaveLength(1)
    expect(bList.data[0].title).toBe('B')
  })

  it('does not create files or rows when updating a non-existent message with attachments', async () => {
    const messageRepository = new SqliteMessageRepository(sqlite, { attachmentsRoot })
    const bytes = Buffer.from('test content', 'utf8')

    await expect(messageRepository.update({
      id: 'msg-nonexistent',
      content: [
        {
          type: 'document',
          source: { type: 'file_id', file_id: 'doc-missing' },
          name: 'doc.txt',
          media_type: 'text/plain',
          size: bytes.length,
          data: bytes.toString('base64'),
        },
      ],
    })).rejects.toThrow('消息未找到')

    await expect(messageRepository.loadAttachmentData('doc-missing')).resolves.toBeNull()
    expect(existsSync(getAttachmentFilePath(attachmentsRoot, 'doc-missing'))).toBe(false)
  })

  it('rejects duplicate file_id and preserves old file and metadata', async () => {
    const messageRepository = new SqliteMessageRepository(sqlite, { attachmentsRoot })
    const conversationRepository = new SqliteConversationRepository(sqlite, {
      prepareConversationAttachmentCleanup: messageRepository.prepareConversationAttachmentCleanup.bind(messageRepository),
    })
    const oldBytes = Buffer.from('old content', 'utf8')
    const newBytes = Buffer.from('new content', 'utf8')

    const conversation = await conversationRepository.create({
      title: 'Duplicate test',
      workspacePath: '/workspace',
      createdAt: 1,
      updatedAt: 1,
      settings: { modelId: 'model-1', providerId: '', systemPrompt: '', temperature: 0.7, maxTokens: 1024 },
    })

    await messageRepository.create({
      convId: conversation.id,
      role: 'user',
      status: 'success',
      content: [
        {
          type: 'document',
          source: { type: 'file_id', file_id: 'doc-dup' },
          name: 'old.txt',
          media_type: 'text/plain',
          size: oldBytes.length,
          data: oldBytes.toString('base64'),
        },
      ],
    })

    const message2 = await messageRepository.create({
      convId: conversation.id,
      role: 'user',
      status: 'success',
      content: [
        {
          type: 'document',
          source: { type: 'file_id', file_id: 'doc-dup' },
          name: 'new.txt',
          media_type: 'text/plain',
          size: newBytes.length,
          data: newBytes.toString('base64'),
        },
      ],
    })

    await expect(messageRepository.loadAttachmentData('doc-dup')).resolves.toBe(oldBytes.toString('base64'))

    const content = (await messageRepository.getById(message2.id)).content
    const docBlock = content.find((b: { type: string }) => b.type === 'document')
    expect(docBlock).toBeDefined()
    expect((docBlock as any).source.file_id).toBe('doc-dup')
  })

  it('cleans up staging files when database update fails', async () => {
    const messageRepository = new SqliteMessageRepository(sqlite, { attachmentsRoot })
    const conversationRepository = new SqliteConversationRepository(sqlite, {
      prepareConversationAttachmentCleanup: messageRepository.prepareConversationAttachmentCleanup.bind(messageRepository),
    })
    const bytes = Buffer.from('staging test', 'utf8')

    const conversation = await conversationRepository.create({
      title: 'Staging test',
      workspacePath: '/workspace',
      createdAt: 1,
      updatedAt: 1,
      settings: { modelId: 'model-1', providerId: '', systemPrompt: '', temperature: 0.7, maxTokens: 1024 },
    })

    const message = await messageRepository.create({
      convId: conversation.id,
      role: 'user',
      status: 'success',
      content: [{ type: 'text', text: 'hello' }],
    })

    await expect(messageRepository.update({
      id: message.id,
      content: [
        {
          type: 'document',
          source: { type: 'file_id', file_id: 'doc-staging' },
          name: 'staging.txt',
          media_type: 'text/plain',
          size: bytes.length,
          data: bytes.toString('base64'),
        },
      ],
    })).resolves.toBeDefined()

    await expect(messageRepository.loadAttachmentData('doc-staging')).resolves.toBe(bytes.toString('base64'))
  })

  it('normal create and update with new IDs succeed and loadAttachmentData returns original bytes', async () => {
    const messageRepository = new SqliteMessageRepository(sqlite, { attachmentsRoot })
    const conversationRepository = new SqliteConversationRepository(sqlite, {
      prepareConversationAttachmentCleanup: messageRepository.prepareConversationAttachmentCleanup.bind(messageRepository),
    })
    const bytes = Buffer.from('normal test', 'utf8')

    const conversation = await conversationRepository.create({
      title: 'Normal test',
      workspacePath: '/workspace',
      createdAt: 1,
      updatedAt: 1,
      settings: { modelId: 'model-1', providerId: '', systemPrompt: '', temperature: 0.7, maxTokens: 1024 },
    })

    const message = await messageRepository.create({
      convId: conversation.id,
      role: 'user',
      status: 'success',
      content: [
        { type: 'text', text: 'see file' },
        {
          type: 'document',
          source: { type: 'file_id', file_id: 'doc-normal' },
          name: 'normal.txt',
          media_type: 'text/plain',
          size: bytes.length,
          data: bytes.toString('base64'),
        },
      ],
    })

    const createdContent = message.content
    const createdDoc = createdContent.find((b: { type: string }) => b.type === 'document')
    expect(createdDoc).toBeDefined()
    expect((createdDoc as any).data).toBeUndefined()
    await expect(messageRepository.loadAttachmentData('doc-normal')).resolves.toBe(bytes.toString('base64'))

    const newBytes = Buffer.from('updated content', 'utf8')
    const updated = await messageRepository.update({
      id: message.id,
      content: [
        { type: 'text', text: 'see updated file' },
        {
          type: 'document',
          source: { type: 'file_id', file_id: 'doc-updated' },
          name: 'updated.txt',
          media_type: 'text/plain',
          size: newBytes.length,
          data: newBytes.toString('base64'),
        },
      ],
    })

    const updatedContent = updated.content
    const updatedDoc = updatedContent.find((b: { type: string }) => b.type === 'document')
    expect(updatedDoc).toBeDefined()
    expect((updatedDoc as any).data).toBeUndefined()
    await expect(messageRepository.loadAttachmentData('doc-updated')).resolves.toBe(newBytes.toString('base64'))
  })
})

function existsSync(filePath: string): boolean {
  try {
    readFileSync(filePath)
    return true
  }
  catch {
    return false
  }
}

function loadBetterSqlite(): new (filename: string) => Database {
  const require = createRequire(import.meta.url)
  return require('better-sqlite3') as new (filename: string) => Database
}
