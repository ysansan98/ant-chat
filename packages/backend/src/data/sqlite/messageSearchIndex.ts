import type { MessageContent } from '@ant-chat/shared'
import type { Statement } from 'better-sqlite3'
import type { AppDataDatabase } from './types'
import { normalizeLegacyMessageContent } from './contentNormalize'

/**
 * 消息搜索投影（可重建的派生读模型）。
 *
 * 负责把 messages.content JSON 抽取为：
 * - message_search_documents：用户可读文本（text/error block）+ 工具文本（tool-call/tool-result）；
 * - message_tool_facts：结构化 tool 事实，供按 tool_name/server_name 精确查询；
 * - messages_fts_unicode / messages_fts_trigram：standalone FTS5 表。
 *
 * 同步必须在 SqliteMessageRepository 的同一事务内调用；migration v9 用 rebuild()
 * 做历史回填。抽取逻辑只存在于本文件，运行时维护与回填共享同一实现。
 */

export interface ToolFact {
  toolCallId: string
  kind: 'call' | 'result'
  toolName: string
  serverName: string | null
  argsText: string
  resultText: string
}

export interface SearchProjection {
  text: string
  toolText: string
  toolFacts: ToolFact[]
}

/** 抽取单条消息的搜索投影。role='event' 的消息不进入投影，由调用方跳过。 */
export function extractSearchProjection(content: MessageContent): SearchProjection {
  let text = ''
  let toolText = ''
  const toolFacts: ToolFact[] = []

  for (const block of content) {
    if (!block || typeof block !== 'object') {
      continue
    }
    const candidate = block as { type?: unknown }
    switch (candidate.type) {
      case 'text': {
        const value = (block as { text?: unknown }).text
        if (typeof value === 'string') {
          text = appendLine(text, value)
        }
        break
      }
      case 'error': {
        const value = (block as { error?: unknown }).error
        if (typeof value === 'string') {
          text = appendLine(text, value)
        }
        break
      }
      case 'annotation': {
        // 批注的引用原文与评论都进入搜索投影，保证批注消息可被搜索命中
        const quote = (block as { quote?: unknown }).quote
        const comment = (block as { comment?: unknown }).comment
        if (typeof quote === 'string' && quote) {
          text = appendLine(text, quote)
        }
        if (typeof comment === 'string' && comment) {
          text = appendLine(text, comment)
        }
        break
      }
      case 'tool-call': {
        const call = block as { toolName?: unknown, toolCallId?: unknown, args?: unknown, serverName?: unknown }
        const toolName = typeof call.toolName === 'string' ? call.toolName : ''
        const toolCallId = typeof call.toolCallId === 'string' ? call.toolCallId : ''
        const serverName = typeof call.serverName === 'string' ? call.serverName : null
        const argsText = serializeJson(call.args)
        toolText = appendLine(toolText, [toolName, argsText].filter(Boolean).join(' '))
        toolFacts.push({ toolCallId, kind: 'call', toolName, serverName, argsText, resultText: '' })
        break
      }
      case 'tool-result': {
        const result = block as { toolName?: unknown, toolCallId?: unknown, result?: unknown }
        const toolName = typeof result.toolName === 'string' ? result.toolName : ''
        const toolCallId = typeof result.toolCallId === 'string' ? result.toolCallId : ''
        const resultText = serializeJson(result.result)
        toolText = appendLine(toolText, [toolName, resultText].filter(Boolean).join(' '))
        toolFacts.push({ toolCallId, kind: 'result', toolName, serverName: null, argsText: '', resultText })
        break
      }
      default:
        // image/document/file/visualization 等附件不进入投影
        break
    }
  }

  return { text, toolText, toolFacts }
}

function serializeJson(value: unknown): string {
  if (value === undefined) {
    return ''
  }
  const serialized = JSON.stringify(value)
  return serialized ?? ''
}

function appendLine(target: string, value: string): string {
  return target ? `${target}\n${value}` : value
}

interface MessageIndexRow {
  id: string
  conv_id: string
  ordinal: number
  role: string
  status: string
  content: string
}

const BACKFILL_CHUNK_SIZE = 2000

export class MessageSearchIndex {
  private readonly selectMessageStmt
  private readonly upsertDocStmt
  private readonly deleteDocStmt
  private readonly deleteFactStmt
  private readonly insertFactStmt
  private readonly insertFtsUnicodeStmt?: Statement
  private readonly insertFtsTrigramStmt?: Statement
  private readonly deleteFtsUnicodeStmt?: Statement
  private readonly deleteFtsTrigramStmt?: Statement
  private readonly fts5Available: boolean
  private readonly trigramAvailable: boolean

  constructor(private readonly db: AppDataDatabase) {
    // FTS 能力在 migration 中显式探测并写入 message_search_meta；
    // 表缺失时（如能力探测失败的降级环境）不准备对应语句，搜索显式走 LIKE。
    const capability = this.readCapability()
    this.fts5Available = capability.fts5
    this.trigramAvailable = capability.ftsTrigram

    this.selectMessageStmt = db.prepare<unknown[], MessageIndexRow>(`
      SELECT id, conv_id, ordinal, role, status, content
      FROM messages
      WHERE id = ?
    `)
    this.upsertDocStmt = db.prepare(`
      INSERT INTO message_search_documents (
        message_id, conversation_id, ordinal, role, status, text, tool_text
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    this.deleteDocStmt = db.prepare('DELETE FROM message_search_documents WHERE message_id = ?')
    // message_tool_facts 通过 FK 级联删除；显式删除保证无 FK 环境（测试）下也一致
    this.deleteFactStmt = db.prepare('DELETE FROM message_tool_facts WHERE message_id = ?')
    this.insertFactStmt = db.prepare(`
      INSERT INTO message_tool_facts (
        message_id, tool_call_id, kind, tool_name, server_name, args_text, result_text
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    if (this.fts5Available) {
      this.insertFtsUnicodeStmt = db.prepare(`
        INSERT INTO messages_fts_unicode (message_id, text, tool_text) VALUES (?, ?, ?)
      `)
      this.deleteFtsUnicodeStmt = db.prepare('DELETE FROM messages_fts_unicode WHERE message_id = ?')
    }
    if (this.trigramAvailable) {
      this.insertFtsTrigramStmt = db.prepare(`
        INSERT INTO messages_fts_trigram (message_id, text, tool_text) VALUES (?, ?, ?)
      `)
      this.deleteFtsTrigramStmt = db.prepare('DELETE FROM messages_fts_trigram WHERE message_id = ?')
    }
  }

  /**
   * 同步单条消息到投影（须在写事务内调用）。
   * role='event' 的消息是压缩产物而非原始证据，只清理不写入。
   */
  upsertMessage(messageId: string): void {
    const row = this.selectMessageStmt.get(messageId)
    if (!row) {
      return
    }
    this.deleteMessage(messageId)
    if (row.role === 'event') {
      return
    }

    const projection = extractSearchProjection(parsePersistedContent(row.content))
    this.upsertDocStmt.run(row.id, row.conv_id, row.ordinal, row.role, row.status, projection.text, projection.toolText)
    for (const fact of projection.toolFacts) {
      this.insertFactStmt.run(row.id, fact.toolCallId, fact.kind, fact.toolName, fact.serverName, fact.argsText, fact.resultText)
    }

    // 空文本消息不进 FTS，避免索引噪音；搜索永远 JOIN 投影表定位消息
    if (!projection.text && !projection.toolText) {
      return
    }
    this.insertFtsUnicodeStmt?.run(row.id, projection.text, projection.toolText)
    this.insertFtsTrigramStmt?.run(row.id, projection.text, projection.toolText)
  }

  /** 从投影与 FTS 移除消息（message_tool_facts 由 FK 级联或显式删除）。 */
  deleteMessage(messageId: string): void {
    this.deleteDocStmt.run(messageId)
    this.deleteFactStmt.run(messageId)
    this.deleteFtsUnicodeStmt?.run(messageId)
    this.deleteFtsTrigramStmt?.run(messageId)
  }

  /** 全量重建投影与 FTS（migration v9 回填与测试用）。 */
  rebuild(): void {
    this.db.exec(`
      DELETE FROM message_tool_facts;
      DELETE FROM message_search_documents;
    `)
    if (this.fts5Available) {
      this.db.exec('DELETE FROM messages_fts_unicode')
    }
    if (this.trigramAvailable) {
      this.db.exec('DELETE FROM messages_fts_trigram')
    }

    let lastRowid = 0
    while (true) {
      const rows = this.db.prepare<unknown[], MessageIndexRow & { rowid: number }>(`
        SELECT rowid, id, conv_id, ordinal, role, status, content
        FROM messages
        WHERE rowid > ?
        ORDER BY rowid
        LIMIT ${BACKFILL_CHUNK_SIZE}
      `).all(lastRowid)
      if (rows.length === 0) {
        break
      }
      for (const row of rows) {
        this.upsertMessage(row.id)
      }
      lastRowid = rows[rows.length - 1].rowid
    }
  }

  private readCapability(): { fts5: boolean, ftsTrigram: boolean } {
    try {
      const rows = this.db.prepare<unknown[], { key: string, value: string }>(`
        SELECT key, value FROM message_search_meta
      `).all()
      const values = new Map(rows.map(row => [row.key, row.value]))
      return {
        fts5: values.get('fts5') === '1',
        ftsTrigram: values.get('fts_trigram') === '1',
      }
    }
    catch {
      // 能力表不存在（例如未跑 migration 的测试库）：整体降级为 LIKE
      return { fts5: false, ftsTrigram: false }
    }
  }
}

function parsePersistedContent(value: string): MessageContent {
  const parsed = JSON.parse(value) as unknown
  if (!Array.isArray(parsed)) {
    throw new TypeError('消息内容格式无效')
  }
  // 兼容旧格式：image 统一之前持久化的消息可能残留 image-block 块，读取时归一到 image。
  return normalizeLegacyMessageContent(parsed) as MessageContent
}
