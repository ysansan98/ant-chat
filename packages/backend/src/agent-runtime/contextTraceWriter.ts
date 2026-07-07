import type {
  BaselineStorage,
  ContextBoundaryPayload,
  ContextItemSnapshot,
  DeltaStorage,
  LoopMessage,
  ModelRequestTracePayload,
  RuntimeToolDefinition,
} from '@ant-chat/shared'
import type { ConversationTaskLoggerManager } from './taskLogWriter'
import {
  buildBaselineSnapshot,
  buildDeltaSnapshot,
  resetMsgCounter,
  snapshotMessage,
  snapshotModelSettings,
  snapshotSystemPrompt,
  snapshotToolDefinitions,
} from './contextTraceService'

// ================================================================
// ContextTraceWriter
//
// 在 Agent Loop 调用 streamModel 前捕获完整输入上下文，
// 与同一 Conversation 的上一次快照比较后写入 Baseline 或 Delta。
// ================================================================

export interface ContextDiagnosticsConfig {
  enabled: boolean
  loggerManager?: ConversationTaskLoggerManager
}

export interface CaptureContextInput {
  conversationId: string
  userTurnId: string
  step: number
  requestId: string
  previousRequestId?: string
  model: string
  provider: string
  providerId: string
  apiMode: string
  systemPrompt: string
  messages: LoopMessage[]
  /** 每条 message 对应的身份 ID（长度应与 messages 一致） */
  messageIdentities: string[]
  toolDefs: RuntimeToolDefinition[]
  modelSettings: { model: string, temperature?: number, maxTokens?: number, systemPrompt?: string }
  /** compaction 后首次请求 true */
  isCompactionBaseline?: boolean
  /** history-rewritten 后首次请求 true */
  isHistoryRewritten?: boolean
}

export class ContextTraceWriter {
  /** 按 conversationId 隔离的 Snapshot（items + hash），用于 Delta 计算 */
  private previousSnapshots = new Map<string, { items: ContextItemSnapshot[], hash: string }>()

  constructor(private readonly config: ContextDiagnosticsConfig) {}

  /**
   * 捕获一次模型请求的上下文快照，写入 JSONL。
   * 返回 null 表示 contextDiagnostics 未启用。
   */
  capture(input: CaptureContextInput): ModelRequestTracePayload | null {
    if (!this.config.enabled) {
      return null
    }
    const {
      conversationId,
      userTurnId,
      step,
      requestId,
      previousRequestId,
      model,
      provider,
      providerId,
      apiMode,
      systemPrompt,
      messages,
      messageIdentities,
      toolDefs,
      modelSettings,
      isCompactionBaseline,
      isHistoryRewritten,
    } = input

    const prevSnapshot = this.previousSnapshots.get(conversationId) ?? null

    let storage: BaselineStorage | DeltaStorage
    let currentSnapshot: { items: ContextItemSnapshot[], hash: string } | null = null

    // Step 1 或 compaction 或 history-rewritten → 写 Baseline
    if (
      !prevSnapshot
      || isCompactionBaseline
      || isHistoryRewritten
    ) {
      const reason = isCompactionBaseline
        ? 'compaction'
        : isHistoryRewritten
          ? 'history-rewritten'
          : 'initial'

      const result = buildBaselineSnapshot(
        systemPrompt,
        messages,
        messageIdentities,
        toolDefs,
        modelSettings,
        reason,
      )
      storage = result.storage
      currentSnapshot = result.snapshot
    }
    else {
      // 增量比较 → 写 Delta
      const currentItems = buildCurrentItemList(
        systemPrompt,
        messages,
        messageIdentities,
        toolDefs,
        modelSettings,
      )
      const result = buildDeltaSnapshot(
        currentItems,
        prevSnapshot.items,
        prevSnapshot.hash,
      )
      storage = result.storage
      currentSnapshot = result.snapshot
    }

    // 校验尚未写入的 Delta 链完整性
    if (storage.kind === 'delta' && prevSnapshot) {
      if (storage.previousSnapshotHash !== prevSnapshot.hash) {
        // hash 链断裂 → 降级写 Baseline (history-rewritten)
        const newResult = buildBaselineSnapshot(
          systemPrompt,
          messages,
          messageIdentities,
          toolDefs,
          modelSettings,
          'history-rewritten',
        )
        storage = newResult.storage
        currentSnapshot = newResult.snapshot
      }
    }

    const tracePayload: ModelRequestTracePayload = {
      schemaVersion: 1,
      requestId,
      previousRequestId,
      conversationId,
      userTurnId,
      step,
      model,
      provider,
      providerId,
      apiMode,
      storage,
    }

    // 写入 JSONL
    if (this.config.loggerManager) {
      const logger = this.config.loggerManager.getLogger(conversationId)
      logger.write('model_request_started', tracePayload as unknown as Record<string, unknown>)
    }

    // 更新内部快照（按 conversationId 隔离）
    if (currentSnapshot) {
      this.previousSnapshots.set(conversationId, currentSnapshot)
    }

    return tracePayload
  }

  /**
   * 记录模型响应（最终请求的文本 + token 用量）。
   * 由 agentLoop 在模型流完成后调用。
   */
  captureResponse(
    conversationId: string,
    requestId: string,
    text: string,
    usage?: ModelRequestTracePayload['responseUsage'],
    finishReason?: string,
  ): void {
    if (!this.config.enabled)
      return

    if (this.config.loggerManager) {
      const logger = this.config.loggerManager.getLogger(conversationId)
      logger.write('model_request_completed', {
        schemaVersion: 1,
        requestId,
        conversationId,
        text,
        usage,
        finishReason,
      } as unknown as Record<string, unknown>)
    }
  }

  /**
   * 写入 Context Boundary（Compaction 成功时调用）。
   */
  writeBoundary(
    conversationId: string,
    boundaryId: string,
    trigger: 'manual' | 'automatic',
    compactedThroughMessageId: string,
  ): ContextBoundaryPayload | null {
    if (!this.config.enabled) {
      return null
    }

    const payload: ContextBoundaryPayload = {
      schemaVersion: 1,
      boundaryId,
      conversationId,
      kind: 'compaction',
      trigger,
      compactedThroughMessageId,
    }

    if (this.config.loggerManager) {
      const logger = this.config.loggerManager.getLogger(conversationId)
      logger.write('context_boundary', payload as unknown as Record<string, unknown>)
    }

    // 清除该会话的快照（下次 capture 会写 compaction Baseline）
    this.previousSnapshots.delete(conversationId)

    return payload
  }

  /**
   * 重置内部快照（用于新 Conversation 或测试）。
   */
  reset(): void {
    this.previousSnapshots.clear()
    resetMsgCounter()
  }

  /**
   * 获取 step 1 request ID 的前缀
   */
  createRequestId(): string {
    return `ctx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }
}

// ================================================================
// 工具函数
// ================================================================

function buildCurrentItemList(
  systemPrompt: string,
  messages: LoopMessage[],
  messageIdentities: string[],
  toolDefs: RuntimeToolDefinition[],
  modelSettings: { model: string, temperature?: number, maxTokens?: number, systemPrompt?: string },
): ContextItemSnapshot[] {
  const items: ContextItemSnapshot[] = []
  let ordinal = 0

  items.push(snapshotSystemPrompt(systemPrompt, ordinal++))
  for (let i = 0; i < messages.length; i++) {
    items.push(snapshotMessage(messages[i], messageIdentities[i] || `msg-${i}`, ordinal++))
  }
  items.push(...snapshotToolDefinitions(toolDefs, ordinal))
  ordinal += toolDefs.length
  items.push(snapshotModelSettings(modelSettings, ordinal))

  return items
}
