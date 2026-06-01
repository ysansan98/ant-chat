import type { AppDataDatabase } from '../types'
import { Buffer } from 'node:buffer'
import * as fs from 'node:fs'
import path from 'node:path'
import { classifyFile } from '@ant-chat/shared'
import { nanoid } from 'nanoid'
import { getAttachmentFilePath } from '../attachmentFiles'

interface OldAttachment {
  uid: string
  name: string
  size: number
  type: string
  data: string
}

export function decodeAttachmentData(data: string): Buffer {
  const commaIndex = data.indexOf(',')
  const base64Data = data.startsWith('data:') && commaIndex !== -1
    ? data.slice(commaIndex + 1)
    : data

  return Buffer.from(base64Data, 'base64')
}

function hasColumn(db: AppDataDatabase, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return rows.some(row => row.name === column)
}

export function migrateMessageAttachments(
  db: AppDataDatabase,
  attachmentsRoot: string,
): void {
  if (!hasColumn(db, 'messages', 'images') || !hasColumn(db, 'messages', 'attachments')) {
    return
  }

  // 检查是否需要迁移
  const needsMigration = db.prepare(`
    SELECT COUNT(*) as count FROM messages
    WHERE images != '[]' OR attachments != '[]'
  `).get() as { count: number }

  if (needsMigration.count === 0) {
    return
  }

  console.log(`Migrating ${needsMigration.count} messages with attachments...`)

  // 确保 attachments 目录存在
  fs.mkdirSync(attachmentsRoot, { recursive: true })

  // 获取需要迁移的消息
  const messages = db.prepare(`
    SELECT id, content, images, attachments FROM messages
    WHERE images != '[]' OR attachments != '[]'
  `).all() as Array<{
    id: string
    content: string
    images: string
    attachments: string
  }>

  const updateMsgStmt = db.prepare(`
    UPDATE messages SET content = ? WHERE id = ?
  `)

  const insertAttachmentStmt = db.prepare(`
    INSERT INTO attachments (id, name, media_type, size, created_at)
    VALUES (?, ?, ?, ?, ?)
  `)

  // 在事务中处理迁移
  const migrationTransaction = db.transaction(() => {
    for (const message of messages) {
      try {
        const content = JSON.parse(message.content)
        const images: OldAttachment[] = JSON.parse(message.images || '[]')
        const attachments: OldAttachment[] = JSON.parse(message.attachments || '[]')

        // 将 images 保存到文件并创建引用
        const imageBlocks = images.map((img) => {
          const fileId = nanoid()
          const filePath = getAttachmentFilePath(attachmentsRoot, fileId)
          fs.mkdirSync(path.dirname(filePath), { recursive: true })
          fs.writeFileSync(filePath, decodeAttachmentData(img.data))

          // 插入 attachments 表记录
          insertAttachmentStmt.run(
            fileId,
            img.name,
            img.type,
            img.size,
            Date.now(),
          )

          return {
            type: 'image-block',
            source: {
              type: 'file_id',
              file_id: fileId,
            },
            name: img.name,
            media_type: img.type,
            size: img.size,
          }
        })

        // 将 attachments 保存到文件并创建引用
        const attachmentBlocks = attachments.map((att) => {
          const fileId = nanoid()
          const filePath = getAttachmentFilePath(attachmentsRoot, fileId)
          fs.mkdirSync(path.dirname(filePath), { recursive: true })
          fs.writeFileSync(filePath, decodeAttachmentData(att.data))

          // 插入 attachments 表记录
          insertAttachmentStmt.run(
            fileId,
            att.name,
            att.type,
            att.size,
            Date.now(),
          )

          const category = classifyFile(att.name, att.type)

          if (category === 'document') {
            return {
              type: 'document',
              source: {
                type: 'file_id',
                file_id: fileId,
              },
              name: att.name,
              media_type: att.type,
              size: att.size,
            }
          }
          else {
            return {
              type: 'file',
              source: {
                type: 'file_id',
                file_id: fileId,
              },
              filename: att.name,
              name: att.name,
              media_type: att.type,
              size: att.size,
            }
          }
        })

        // 合并到 content 数组
        const newContent = [...content, ...imageBlocks, ...attachmentBlocks]

        updateMsgStmt.run(JSON.stringify(newContent), message.id)
      }
      catch (error) {
        console.error(`Failed to migrate message ${message.id}:`, error)
        throw error // 重新抛出错误，让事务回滚
      }
    }
  })

  migrationTransaction()
  console.log('Message attachment migration completed.')
}

// 重建 messages 表，删除 images 和 attachments 列
export function rebuildMessagesTable(db: AppDataDatabase): void {
  if (!hasColumn(db, 'messages', 'images') || !hasColumn(db, 'messages', 'attachments')) {
    return
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS messages_new (
      id text PRIMARY KEY NOT NULL,
      conv_id text NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role text NOT NULL,
      content text NOT NULL,
      created_at integer NOT NULL,
      status text NOT NULL,
      reasoning_content text,
      model_info text DEFAULT NULL,
      usage text DEFAULT NULL,
      turn_id text DEFAULT NULL,
      event_type text DEFAULT NULL
    );

    INSERT INTO messages_new
    SELECT id, conv_id, role, content, created_at, status,
           reasoning_content, model_info, usage, turn_id, event_type
    FROM messages;

    DROP TABLE messages;

    ALTER TABLE messages_new RENAME TO messages;
  `)

  console.log('Messages table rebuilt without images/attachments columns.')
}
