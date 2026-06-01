import type { Database } from 'better-sqlite3'
import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getAttachmentFilePath } from '../../attachmentFiles'
import { initializeAppDataSchema } from '../../schema'
import { migrateMessageAttachments } from '../migrateAttachments'

describe.skipIf(!canRunDbIntegrationTests())('migrateMessageAttachments', () => {
  let sqlite: Database
  let attachmentsRoot: string

  beforeEach(() => {
    const BetterSqlite = loadBetterSqlite()
    sqlite = new BetterSqlite(':memory:')
    initializeAppDataSchema(sqlite)
    sqlite.exec(`
      ALTER TABLE messages ADD COLUMN images text DEFAULT '[]';
      ALTER TABLE messages ADD COLUMN attachments text DEFAULT '[]';
    `)
    attachmentsRoot = mkdtempSync(path.join(tmpdir(), 'ant-chat-attachments-'))
  })

  afterEach(() => {
    sqlite.close()
    rmSync(attachmentsRoot, { force: true, recursive: true })
  })

  it('writes old base64 attachment data as decoded file bytes', () => {
    const imageBytes = Buffer.from([0x89, 0x50, 0x4E, 0x47])
    const textBytes = Buffer.from('hello attachment\n', 'utf8')

    sqlite.prepare(`
      INSERT INTO conversations (id, title, created_at, updated_at, settings)
      VALUES (?, ?, ?, ?, ?)
    `).run('conv-1', 'Test', 1, 1, '{}')

    sqlite.prepare(`
      INSERT INTO messages (
        id,
        conv_id,
        role,
        content,
        created_at,
        status,
        images,
        attachments
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'msg-1',
      'conv-1',
      'user',
      JSON.stringify([{ type: 'text', text: 'prompt' }]),
      1,
      'success',
      JSON.stringify([{
        uid: 'image-1',
        name: 'image.png',
        size: imageBytes.length,
        type: 'image/png',
        data: imageBytes.toString('base64'),
      }]),
      JSON.stringify([{
        uid: 'file-1',
        name: 'note.txt',
        size: textBytes.length,
        type: 'text/plain',
        data: `data:text/plain;base64,${textBytes.toString('base64')}`,
      }]),
    )

    migrateMessageAttachments(sqlite, attachmentsRoot)

    const message = sqlite.prepare('SELECT content FROM messages WHERE id = ?').get('msg-1') as { content: string }
    const content = JSON.parse(message.content)
    const imageBlock = content[1]
    const documentBlock = content[2]

    expect(content[0]).toEqual({ type: 'text', text: 'prompt' })
    expect(imageBlock).toEqual({
      type: 'image-block',
      source: { type: 'file_id', file_id: imageBlock.source.file_id },
      name: 'image.png',
      media_type: 'image/png',
      size: imageBytes.length,
    })
    expect(documentBlock).toEqual({
      type: 'document',
      source: { type: 'file_id', file_id: documentBlock.source.file_id },
      name: 'note.txt',
      media_type: 'text/plain',
      size: textBytes.length,
    })

    expect(readFileSync(getAttachmentFilePath(attachmentsRoot, imageBlock.source.file_id))).toEqual(imageBytes)
    expect(readFileSync(getAttachmentFilePath(attachmentsRoot, documentBlock.source.file_id))).toEqual(textBytes)

    const attachmentRows = sqlite.prepare(`
      SELECT id, name, media_type, size FROM attachments ORDER BY name
    `).all()

    expect(attachmentRows).toEqual([
      {
        id: imageBlock.source.file_id,
        name: 'image.png',
        media_type: 'image/png',
        size: imageBytes.length,
      },
      {
        id: documentBlock.source.file_id,
        name: 'note.txt',
        media_type: 'text/plain',
        size: textBytes.length,
      },
    ])
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
