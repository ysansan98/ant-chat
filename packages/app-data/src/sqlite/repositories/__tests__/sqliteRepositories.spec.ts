import type { Database } from 'better-sqlite3'
import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
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

describe.skipIf(!canRunDbIntegrationTests())('sqlite repositories', () => {
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
})

function canRunDbIntegrationTests() {
  const result = spawnSync(process.execPath, ['-e', `
    const { createRequire } = require('node:module')
    const requireFromTest = createRequire(${JSON.stringify(import.meta.url)})
    const Database = requireFromTest('better-sqlite3')
    const db = new Database(':memory:')
    db.close()
  `], { stdio: 'ignore' })

  return result.status === 0 && result.signal === null
}

function loadBetterSqlite(): new (filename: string) => Database {
  const require = createRequire(import.meta.url)
  return require('better-sqlite3') as new (filename: string) => Database
}
