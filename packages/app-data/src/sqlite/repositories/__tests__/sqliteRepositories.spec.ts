import type { Database } from 'better-sqlite3'
import BetterSqlite from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../../schema'
import { SqliteConversationRepository } from '../sqliteConversationRepository'
import { SqliteMessageRepository } from '../sqliteMessageRepository'
import { SqliteSettingsRepository } from '../sqliteSettingsRepository'

describe('sqlite repositories', () => {
  let sqlite: Database
  let db: ReturnType<typeof drizzle<typeof schema>>

  beforeEach(() => {
    sqlite = new BetterSqlite(':memory:')
    sqlite.exec(`
      CREATE TABLE conversations (
        id text PRIMARY KEY NOT NULL,
        workspace_path text,
        title text NOT NULL,
        created_at integer NOT NULL,
        updated_at integer NOT NULL,
        settings text NOT NULL
      );
      CREATE INDEX idx_conversations_workspace_path_updated_at ON conversations (workspace_path, updated_at);
      CREATE INDEX idx_conversations_updated_at ON conversations (updated_at);
      CREATE TABLE messages (
        id text PRIMARY KEY NOT NULL,
        conv_id text NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role text NOT NULL,
        content text NOT NULL,
        created_at integer NOT NULL,
        status text NOT NULL,
        images text DEFAULT '[]',
        attachments text DEFAULT '[]',
        reasoning_content text,
        tool_calls text DEFAULT NULL,
        model_info text DEFAULT NULL,
        usage text DEFAULT NULL
      );
      CREATE TABLE app_settings (
        key text PRIMARY KEY NOT NULL,
        value text NOT NULL,
        updated_at integer NOT NULL
      );
    `)
    db = drizzle(sqlite, { schema })
  })

  afterEach(() => {
    sqlite.close()
  })

  it('creates conversations and paginates messages', async () => {
    const conversationRepository = new SqliteConversationRepository(db)
    const messageRepository = new SqliteMessageRepository(db)

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
    expect(messages).toEqual({
      data: [expect.objectContaining({ id: message.id, convId: conversation.id })],
      total: 1,
    })
  })

  it('updates general settings in sqlite', async () => {
    const repository = new SqliteSettingsRepository(db)

    const settings = await repository.updateGeneralSettings({
      assistantModelId: 'model-1',
      proxySettings: { mode: 'custom', customProxyUrl: 'http://localhost:7890' },
    })

    expect(settings).toEqual({
      assistantModelId: 'model-1',
      proxySettings: { mode: 'custom', customProxyUrl: 'http://localhost:7890' },
    })
    await expect(repository.getGeneralSettings()).resolves.toEqual(settings)
  })
})
