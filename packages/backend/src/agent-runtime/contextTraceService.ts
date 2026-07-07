import type {
  BaselineStorage,
  ContextItemSnapshot,
  ContextItemStatus,
  ContextItemUpdate,
  DeltaStorage,
  LoopMessage,
  RuntimeToolDefinition,
  ToolCallContent,
  ToolResultContent,
} from '@ant-chat/shared'
import crypto from 'node:crypto'

// ================================================================
// Context Item 快照构建
// ================================================================

export function snapshotSystemPrompt(content: string, ordinal: number): ContextItemSnapshot {
  return {
    identity: { id: 'system-prompt' },
    status: 'full',
    kind: 'system-prompt',
    ordinal,
    content,
    size: content.length,
  }
}

export function snapshotMessage(
  message: LoopMessage,
  id: string,
  ordinal: number,
  status: ContextItemStatus = 'full',
): ContextItemSnapshot {
  const textContent = message.content
    .filter(c => c.type === 'text')
    .map(c => c.text)
    .join('')

  // 提取所有工具调用/结果
  const allToolContent = message.content.filter(
    (c): c is ToolCallContent | ToolResultContent => c.type === 'tool-call' || c.type === 'tool-result',
  )
  const firstTool = allToolContent[0]

  // 构建 tools 列表
  const tools: ContextItemSnapshot['tools'] = allToolContent.length > 0
    ? allToolContent.map((t) => {
        if (t.type === 'tool-call') {
          return { type: 'tool-call' as const, toolName: t.toolName, toolCallId: (t as ToolCallContent).toolCallId, args: (t as ToolCallContent).args }
        }
        return { type: 'tool-result' as const, toolName: t.toolName, toolCallId: (t as ToolResultContent).toolCallId, result: (t as ToolResultContent).result, isError: (t as ToolResultContent).isError }
      })
    : undefined

  // 第一个工具的快捷字段
  let toolName: string | undefined
  let toolCallId: string | undefined
  let toolArgs: Record<string, unknown> | undefined
  let toolResult: string | undefined
  let isError: boolean | undefined
  if (firstTool) {
    toolName = firstTool.toolName
    if (firstTool.type === 'tool-call') {
      toolCallId = (firstTool as ToolCallContent).toolCallId
      toolArgs = (firstTool as ToolCallContent).args
    }
    else {
      toolCallId = (firstTool as ToolResultContent).toolCallId
      toolResult = (firstTool as ToolResultContent).result
      isError = (firstTool as ToolResultContent).isError
    }
  }

  return {
    identity: { id },
    status,
    kind: 'message',
    ordinal,
    role: message.role,
    content: textContent,
    toolName,
    toolCallId,
    toolArgs,
    toolResult,
    isError,
    tools,
    size: allToolContent.length > 0 ? allToolContent.length : textContent.length,
  }
}

export function snapshotToolDefinitions(
  tools: RuntimeToolDefinition[],
  ordinal: number,
): ContextItemSnapshot[] {
  return tools.map((tool, index) => ({
    identity: {
      id: `${tool.source || 'native'}|${tool.serverName || ''}|${tool.name}`,
    },
    status: 'full' as ContextItemStatus,
    kind: 'tool-definition' as const,
    ordinal: ordinal + index,
    source: tool.source || 'native',
    serverName: tool.serverName || '',
    toolName: tool.name,
    content: JSON.stringify({ description: tool.description, inputSchema: tool.inputSchema }, null, 2),
    size: JSON.stringify(tool).length,
  }))
}

export function snapshotModelSettings(
  settings: { model: string, temperature?: number, maxTokens?: number, systemPrompt?: string },
  ordinal: number,
): ContextItemSnapshot {
  return {
    identity: { id: 'model-settings' },
    status: 'full',
    kind: 'model-settings',
    ordinal,
    settings: settings as unknown as Record<string, unknown>,
    size: Object.keys(settings).length,
  }
}

// ================================================================
// Snapshot 比较与 Diff
// ================================================================

export interface SnapshotSet {
  items: ContextItemSnapshot[]
  hash: string
}

export function computeSnapshotHash(items: ContextItemSnapshot[]): string {
  const serial = items
    .map(item => `${item.identity.id}:${item.status}:${item.ordinal}`)
    .join('|')
  return crypto.createHash('sha256').update(serial).digest('hex').slice(0, 16)
}

export function buildBaselineSnapshot(
  systemPrompt: string,
  messages: LoopMessage[],
  messageIds: string[],
  toolDefs: RuntimeToolDefinition[],
  modelSettings: { model: string, temperature?: number, maxTokens?: number, systemPrompt?: string },
  reason: 'initial' | 'compaction' | 'history-rewritten' = 'initial',
): {
  storage: BaselineStorage
  snapshot: SnapshotSet
} {
  const items: ContextItemSnapshot[] = []
  let ordinal = 0

  // 1. System Prompt
  items.push(snapshotSystemPrompt(systemPrompt, ordinal++))
  ordinal++

  // 2. Messages
  for (let i = 0; i < messages.length; i++) {
    const msgId = messageIds[i] || `msg-${i}`
    const status = reason === 'compaction' && i === 0 ? 'added' : 'full'
    items.push(snapshotMessage(messages[i], msgId, ordinal++, status))
  }

  // 3. Tool Definitions
  const toolItems = snapshotToolDefinitions(toolDefs, ordinal)
  items.push(...toolItems)
  ordinal += toolItems.length

  // 4. Model Settings
  items.push(snapshotModelSettings(modelSettings, ordinal))

  const hash = computeSnapshotHash(items)
  const addedItemIds = reason === 'compaction'
    ? items.filter(i => i.status === 'added').map(i => i.identity.id)
    : undefined

  return {
    storage: {
      kind: 'baseline',
      reason,
      items,
      addedItemIds,
      snapshotHash: hash,
    },
    snapshot: { items, hash },
  }
}

export function buildDeltaSnapshot(
  currentItems: ContextItemSnapshot[],
  previousItems: ContextItemSnapshot[],
  previousHash: string,
): {
  storage: DeltaStorage
  snapshot: SnapshotSet
} {
  const added: ContextItemSnapshot[] = []
  const updated: ContextItemUpdate[] = []
  const removed: ContextItemSnapshot[] = []

  // Build index of previous items by identity
  const prevByIdentity = new Map<string, ContextItemSnapshot>()
  for (const item of previousItems) {
    prevByIdentity.set(item.identity.id, item)
  }

  // Detect added / updated
  for (const current of currentItems) {
    const prev = prevByIdentity.get(current.identity.id)
    if (!prev) {
      // New item
      added.push({ ...current, status: 'added' })
      continue
    }

    // Updated (only for non-message items)
    if (prev.kind !== 'message' && current.kind !== 'message') {
      const diffs = computeFieldDiffs(prev, current)
      if (diffs.length > 0) {
        updated.push(...diffs)
        current.status = 'updated'
      }
    }
  }

  // Detect removed (present in previous but not in current)
  const currentIds = new Set(currentItems.map(i => i.identity.id))
  for (const prev of previousItems) {
    if (!currentIds.has(prev.identity.id)) {
      removed.push({ ...prev, status: 'removed' })
    }
  }

  const allItems = mergeSnapshots(previousItems, currentItems)
  const hash = computeSnapshotHash(allItems)

  return {
    storage: {
      kind: 'delta',
      added,
      updated,
      removed,
      previousSnapshotHash: previousHash,
      snapshotHash: hash,
    },
    snapshot: { items: allItems, hash },
  }
}

function computeFieldDiffs(prev: ContextItemSnapshot, current: ContextItemSnapshot): ContextItemUpdate[] {
  const diffs: ContextItemUpdate[] = []

  // Tool definition diff: compare input schema / description
  if (prev.kind === 'tool-definition' && current.kind === 'tool-definition') {
    if (prev.content !== current.content) {
      diffs.push({
        identity: current.identity,
        kind: 'tool-definition',
        field: 'description',
        before: prev.content,
        after: current.content,
      })
    }
  }

  // Model settings diff: compare each settings field
  if (prev.kind === 'model-settings' && current.kind === 'model-settings') {
    const prevSettings = prev.settings || {}
    const currSettings = current.settings || {}
    const allKeys = new Set([...Object.keys(prevSettings), ...Object.keys(currSettings)])
    for (const key of allKeys) {
      const before = prevSettings[key]
      const after = currSettings[key]
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        diffs.push({
          identity: current.identity,
          kind: 'model-settings',
          field: key,
          before,
          after,
        })
      }
    }
  }

  return diffs
}

function mergeSnapshots(previous: ContextItemSnapshot[], current: ContextItemSnapshot[]): ContextItemSnapshot[] {
  const merged = new Map<string, ContextItemSnapshot>()
  for (const item of previous) {
    merged.set(item.identity.id, item)
  }
  for (const item of current) {
    merged.set(item.identity.id, item)
  }
  return Array.from(merged.values())
}

// ================================================================
// 身份生成（运行中 Message）
// ================================================================

let msgCounter = 0

export function generateMessageIdentity(requestId: string, role: string): string {
  msgCounter++
  return `${requestId}:${role}:${msgCounter}`
}

export function getToolDefinitionIdentity(tool: RuntimeToolDefinition): string {
  return `${tool.source || 'native'}|${tool.serverName || ''}|${tool.name}`
}

export function resetMsgCounter(): void {
  msgCounter = 0
}
