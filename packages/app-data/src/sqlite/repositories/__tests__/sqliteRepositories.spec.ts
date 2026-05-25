import type { Database } from 'better-sqlite3'
import { createRequire } from 'node:module'
import BetterSqlite from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initializeAppDataSchema } from '../../schema'
import { SqliteMessageSearchService } from '../../services'
import { SqliteConversationRepository } from '../sqliteConversationRepository'
import { SqliteMessageRepository } from '../sqliteMessageRepository'

describe.skipIf(!canRunDbIntegrationTests())('sqlite repositories', () => {
  let sqlite: Database

  beforeEach(() => {
    sqlite = new BetterSqlite(':memory:')
    initializeAppDataSchema(sqlite)
  })

  afterEach(() => {
    sqlite.close()
  })

  it('creates conversations and paginates messages', async () => {
    const conversationRepository = new SqliteConversationRepository(sqlite)
    const messageRepository = new SqliteMessageRepository(sqlite)

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
      images: [],
      attachments: [],
    })

    const messages = await messageRepository.listByConversationPaginated(conversation.id, 0, 20)

    expect(message.convId).toBe(conversation.id)
    expect(message.content).toEqual([{ type: 'text', text: 'hello' }])
    expect(messages).toEqual({
      data: [expect.objectContaining({ id: message.id, convId: conversation.id })],
      total: 1,
    })
  })

  it('searches text messages by keyword grouped by conversation', async () => {
    const conversationRepository = new SqliteConversationRepository(sqlite)
    const messageRepository = new SqliteMessageRepository(sqlite)
    const searchService = new SqliteMessageSearchService(sqlite)

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
      images: [],
      attachments: [],
    })
    await messageRepository.create({
      convId: newerConversation.id,
      role: 'user',
      status: 'success',
      content: [{ type: 'image', mimeType: 'image/png', data: 'base64' }],
      images: [],
      attachments: [],
    })
    const matchedMessage = await messageRepository.create({
      convId: newerConversation.id,
      role: 'user',
      status: 'success',
      content: [{ type: 'text', text: 'newer conversation has needle' }],
      images: [],
      attachments: [],
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
})

function canRunDbIntegrationTests() {
  try {
    const require = createRequire(import.meta.url)
    const Database = require('better-sqlite3')
    const db = new Database(':memory:')
    db.close()
    return true
  }
  catch {
    return false
  }
}
