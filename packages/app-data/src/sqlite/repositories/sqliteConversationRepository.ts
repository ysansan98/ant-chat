import type { AddConversationsSchema, IConversations, UpdateConversationsSchema } from '@ant-chat/shared'
import type { ConversationRepository } from '../../repositories'
import type { ConversationRow } from '../rows'
import type { AppDataDatabase } from '../types'
import { AddConversationsSchema as AddConversationInput, UpdateConversationsSchema as UpdateConversationInput } from '@ant-chat/shared'
import { nanoid } from 'nanoid'
import { mapConversationRow, stringifyJson } from '../rows'

interface SqliteConversationRepositoryOptions {
  prepareConversationAttachmentCleanup?: (conversationId: string) => () => void
}

const CONVERSATION_COLUMNS = `
  id,
  workspace_path,
  title,
  created_at,
  updated_at,
  settings
`

export class SqliteConversationRepository implements ConversationRepository {
  constructor(
    private readonly db: AppDataDatabase,
    private readonly options: SqliteConversationRepositoryOptions = {},
  ) {}

  async list(pageIndex: number, pageSize: number = 10, workspacePath?: string, includeNullWorkspace = false) {
    const workspaceWhere = getWorkspaceWhere(workspacePath, includeNullWorkspace)
    const totalResult = this.db.prepare<unknown[], { count: number }>(`
      SELECT count(1) AS count
      FROM conversations
      ${workspaceWhere.sql}
    `).get(...workspaceWhere.params)
    const data = this.db.prepare<unknown[], ConversationRow>(`
      SELECT ${CONVERSATION_COLUMNS}
      FROM conversations
      ${workspaceWhere.sql}
      ORDER BY updated_at DESC
      LIMIT ? OFFSET ?
    `).all(...workspaceWhere.params, pageSize, pageIndex * pageSize)

    return {
      data: data.map(mapConversationRow),
      total: totalResult?.count ?? 0,
    }
  }

  async getById(id: string): Promise<IConversations> {
    const result = this.db.prepare<unknown[], ConversationRow>(`
      SELECT ${CONVERSATION_COLUMNS}
      FROM conversations
      WHERE id = ?
    `).get(id)
    if (!result) {
      throw new Error(`${id} 不存在`)
    }

    return mapConversationRow(result)
  }

  async create(conversation: AddConversationsSchema): Promise<IConversations> {
    const parsed = AddConversationInput.parse(conversation)
    const id = `conv-${nanoid()}`
    const result = this.db.prepare<unknown[], ConversationRow>(`
      INSERT INTO conversations (id, workspace_path, title, created_at, updated_at, settings)
      VALUES (?, ?, ?, ?, ?, ?)
      RETURNING ${CONVERSATION_COLUMNS}
    `).get(
      id,
      parsed.workspacePath ?? null,
      parsed.title,
      parsed.createdAt,
      parsed.updatedAt,
      stringifyJson(parsed.settings),
    )

    if (!result) {
      throw new Error('创建会话失败')
    }

    return mapConversationRow(result)
  }

  async update(conversation: UpdateConversationsSchema): Promise<IConversations> {
    const data = UpdateConversationInput.parse(conversation)
    const fields: string[] = []
    const params: unknown[] = []

    if (data.workspacePath !== undefined) {
      fields.push('workspace_path = ?')
      params.push(data.workspacePath ?? null)
    }
    if (data.title !== undefined) {
      fields.push('title = ?')
      params.push(data.title)
    }
    if (data.createdAt !== undefined) {
      fields.push('created_at = ?')
      params.push(data.createdAt)
    }
    if (data.updatedAt !== undefined) {
      fields.push('updated_at = ?')
      params.push(data.updatedAt)
    }
    if (data.settings !== undefined) {
      fields.push('settings = ?')
      params.push(stringifyJson(data.settings))
    }

    if (fields.length === 0) {
      return this.getById(data.id)
    }

    const result = this.db.prepare<unknown[], ConversationRow>(`
      UPDATE conversations
      SET ${fields.join(', ')}
      WHERE id = ?
      RETURNING ${CONVERSATION_COLUMNS}
    `).get(...params, data.id)

    if (!result) {
      throw new Error('会话未找到')
    }

    return mapConversationRow(result)
  }

  async delete(id: string): Promise<boolean> {
    let cleanupFiles = () => {}
    const deleteConversation = this.db.transaction(() => {
      cleanupFiles = this.options.prepareConversationAttachmentCleanup?.(id) ?? cleanupFiles
      const result = this.db.prepare('DELETE FROM conversations WHERE id = ?').run(id)
      if (result.changes === 0)
        throw new Error('会话未找到')
    })

    deleteConversation()
    cleanupFiles()
    return true
  }

  async deleteByWorkspace(workspacePath?: string, includeNullWorkspace = false): Promise<string[]> {
    const workspaceWhere = getWorkspaceWhere(workspacePath, includeNullWorkspace)
    const rows = this.db.prepare<unknown[], { id: string }>(`
      SELECT id FROM conversations ${workspaceWhere.sql}
    `).all(...workspaceWhere.params)
    const ids = rows.map(row => row.id)

    if (ids.length === 0) {
      return []
    }

    const cleanupCallbacks: (() => void)[] = []
    const deleteAll = this.db.transaction(() => {
      for (const id of ids) {
        const cleanup = this.options.prepareConversationAttachmentCleanup?.(id)
        if (cleanup) {
          cleanupCallbacks.push(cleanup)
        }
        this.db.prepare('DELETE FROM conversations WHERE id = ?').run(id)
      }
    })

    deleteAll()
    for (const cleanup of cleanupCallbacks) {
      cleanup()
    }

    return ids
  }

  async exists(id: string): Promise<boolean> {
    const result = this.db.prepare<unknown[], { count: number }>(`
      SELECT count(1) AS count
      FROM conversations
      WHERE id = ?
    `).get(id)

    return (result?.count ?? 0) > 0
  }

  async updateUpdatedAt(id: string, updatedAt: number): Promise<IConversations> {
    return this.update({ id, updatedAt })
  }
}

function getWorkspaceWhere(workspacePath?: string, includeNullWorkspace = false): { params: unknown[], sql: string } {
  if (!workspacePath) {
    return { params: [], sql: '' }
  }

  return includeNullWorkspace
    ? { params: [workspacePath], sql: 'WHERE (workspace_path = ? OR workspace_path IS NULL)' }
    : { params: [workspacePath], sql: 'WHERE workspace_path = ?' }
}
