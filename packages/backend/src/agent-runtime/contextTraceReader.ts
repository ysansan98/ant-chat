import type {
  ContextBoundaryPayload,
  ContextTraceItemDetail,
  ContextTraceListItem,
  ModelRequestCompletedPayload,
  TaskTraceEnvelope,
} from '@ant-chat/shared'
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'

// ================================================================
// ContextTraceReader — 逆向分页读取 Task JSONL
// ================================================================

export interface TraceReaderOptions {
  taskLogsRoot: string
}

export interface CursorInfo {
  /** 文件中的行号偏移（从 0 开始） */
  lineOffset: number
}

/**
 * 创建一个 ContextTraceReader，用于逆向分页读取 Conversation JSONL 文件。
 */
export function createContextTraceReader(options: TraceReaderOptions) {
  const { taskLogsRoot } = options

  async function listTraceItems(
    conversationId: string,
    before?: string,
    limit = 200,
  ): Promise<{ items: ContextTraceListItem[], nextCursor?: string, hasMore: boolean }> {
    const filePath = path.join(taskLogsRoot, `${conversationId}.jsonl`)

    if (!fs.existsSync(filePath)) {
      return { items: [], hasMore: false }
    }

    const content = fs.readFileSync(filePath, 'utf-8')
    const lines = content.trimEnd().split('\n').filter(Boolean)

    // 解析游标
    let endIdx = lines.length // exclusive end
    if (before) {
      try {
        const cursor: CursorInfo = JSON.parse(Buffer.from(before, 'base64').toString('utf-8'))
        endIdx = cursor.lineOffset
      }
      catch {
        // invalid cursor → return from end
      }
    }

    const startIdx = Math.max(0, endIdx - limit)
    const slice = lines.slice(startIdx, endIdx)

    // 收集当前分片中的所有 requestId（model_request_started → 标记，model_request_completed → 查找）
    const completedReqIds = new Set<string>()
    for (const line of slice) {
      try {
        const envelope: TaskTraceEnvelope = JSON.parse(line)
        if (envelope.event === 'model_request_completed') {
          const p = envelope.payload as Record<string, unknown>
          if (p.requestId)
            completedReqIds.add(p.requestId as string)
        }
      }
      catch { /* skip */ }
    }

    // 仅返回 model_request_started 和 context_boundary 事件
    const items: ContextTraceListItem[] = []
    for (const line of slice) {
      try {
        const envelope: TaskTraceEnvelope = JSON.parse(line)
        if (envelope.event === 'model_request_started') {
          const payload = envelope.payload as Record<string, unknown>
          // 跳过旧格式的 model_request_started（没有 requestId 和 storage）
          if (!payload.requestId || !payload.storage) {
            continue
          }
          const storage = payload.storage as { kind: string, reason?: string, items?: unknown[] } | undefined

          items.push({
            requestId: payload.requestId as string,
            previousRequestId: payload.previousRequestId as string | undefined,
            conversationId: payload.conversationId as string,
            step: payload.step as number,
            model: payload.model as string,
            provider: payload.provider as string,
            storageKind: storage?.kind as 'baseline' | 'delta' || 'baseline',
            storageReason: storage?.kind === 'baseline' ? (storage.reason as 'initial' | 'compaction' | 'history-rewritten') : undefined,
            hasResponse: completedReqIds.has(payload.requestId as string),
            itemCount: (storage?.items)?.length ?? 0,
            time: envelope.time,
          })
        }
      }
      catch {
        // skip malformed lines
      }
    }

    const hasMore = startIdx > 0
    const nextCursor = hasMore
      ? Buffer.from(JSON.stringify({ lineOffset: startIdx } satisfies CursorInfo)).toString('base64')
      : undefined

    return { items, nextCursor, hasMore }
  }

  async function getTraceItem(
    conversationId: string,
    requestId: string,
    _itemId: string,
  ): Promise<ContextTraceItemDetail | null> {
    const filePath = path.join(taskLogsRoot, `${conversationId}.jsonl`)

    if (!fs.existsSync(filePath))
      return null

    const content = fs.readFileSync(filePath, 'utf-8')
    const lines = content.trimEnd().split('\n').filter(Boolean)

    let storage: ContextTraceItemDetail['storage'] | undefined
    let boundary: ContextTraceItemDetail['boundary']
    let response: ContextTraceItemDetail['response'] | undefined

    for (const line of lines) {
      try {
        const envelope: TaskTraceEnvelope = JSON.parse(line)
        if (envelope.event === 'model_request_started') {
          const payload = envelope.payload as Record<string, unknown>
          if (payload.requestId === requestId) {
            storage = payload.storage as ContextTraceItemDetail['storage']
          }
        }
        if (envelope.event === 'model_request_completed') {
          const p = envelope.payload as Record<string, unknown>
          if (p.requestId === requestId) {
            response = {
              text: p.text as string,
              usage: p.usage as ModelRequestCompletedPayload['usage'],
              finishReason: p.finishReason as string | undefined,
            }
          }
        }
        if (envelope.event === 'context_boundary' && envelope.payload) {
          const bp = envelope.payload as Record<string, unknown>
          if (bp.boundaryId === requestId) {
            boundary = bp as unknown as ContextBoundaryPayload
          }
        }
      }
      catch {
        // skip malformed lines
      }
    }

    if (!storage)
      return null

    return {
      requestId,
      storage,
      boundary,
      response,
    }
  }

  return {
    listTraceItems,
    getTraceItem,
  }
}

export type ContextTraceReader = ReturnType<typeof createContextTraceReader>
