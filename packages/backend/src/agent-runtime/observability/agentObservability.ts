import type {
  AgentObservabilityEvidence,
  AgentObservabilityPort,
  AgentObservabilityRecord,
  AgentObservabilityRecordInput,
  AgentObservationSpan,
  AgentTurnIdentity,
  AgentTurnRecorder,
  AgentTurnSummary,
  AgentTurnTimeline,
  AvailableAgentTurnSummary,
  CollectingAgentTurnSummary,
  CompletedAgentTurnSummary,
  ContextEventKind,
  ILogger,
  TraceIncompleteReason,
  TraceSpanKind,
  TraceSpanStatus,
} from '@ant-chat/shared'
import type { Dirent } from 'node:fs'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { mkdir, open, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { AgentObservabilityRecordSchema } from '@ant-chat/shared'
import { applyContextSnapshot, createContextSnapshot } from './contextDelta'
import { redactObservabilityEvidence } from './redaction'

const DEFAULT_QUEUE_BYTES = 8 * 1024 * 1024
const DEFAULT_QUOTA_BYTES = 512 * 1024 * 1024
const DEFAULT_QUOTA_TARGET_BYTES = 384 * 1024 * 1024
const DEFAULT_FLUSH_TIMEOUT_MS = 1_500
const NOOP_SPAN: AgentObservationSpan = { id: '', complete() {}, fail() {}, cancel() {} }
const NOOP_RECORDER: AgentTurnRecorder = {
  startModelRequest: () => NOOP_SPAN,
  startToolCall: () => NOOP_SPAN,
  startPolicyDecision: () => NOOP_SPAN,
  recordContextEvent() {},
  finish() {},
}

export interface AgentObservabilityOptions {
  rootDir: string
  logger?: ILogger
  onTurnSettled?: (input: { conversationId: string, turnId: string }) => void
  queueByteLimit?: number
  quotaBytes?: number
  quotaTargetBytes?: number
  flushTimeoutMs?: number
  legacyRoots?: string[]
}

interface QueuedRecord {
  key: string
  filePath: string
  line: string
  bytes: number
  recordType: AgentObservabilityRecord['recordType'] | 'overflow-terminal'
}

interface ParsedTurn {
  records: AgentObservabilityRecord[]
  summary: AvailableAgentTurnSummary
}

type AgentTurnMeta = Parameters<AgentObservabilityPort['beginTurn']>[0]

interface RuntimeTurnState {
  meta: AgentTurnMeta
  traceId: string
  startedAt: number
  endedAt?: number
  status?: CompletedAgentTurnSummary['status']
  errorSummary?: string
  spanCounts: AvailableAgentTurnSummary['spanCounts']
}

export class AgentObservability implements AgentObservabilityPort {
  private enabled = false
  private queue: QueuedRecord[] = []
  private queueBytes = 0
  private draining: Promise<void> | null = null
  private maintenance: Promise<void> = Promise.resolve()
  private readonly stoppedTurns = new Set<string>()
  private readonly discardedTurns = new Set<string>()
  private readonly overflowMarkers = new Set<string>()
  private readonly overflowSequences = new Map<string, { first: number, last: number }>()
  private readonly activeTurns = new Set<string>()
  private readonly runtimeIncomplete = new Map<string, Set<TraceIncompleteReason>>()
  private readonly runtimeTurns = new Map<string, RuntimeTurnState>()

  constructor(private readonly options: AgentObservabilityOptions) {}

  async initialize(): Promise<void> {
    try {
      await mkdir(this.options.rootDir, { recursive: true })
    }
    catch (error) {
      this.options.logger?.error('初始化 Agent Observability 存储失败', error)
      return
    }
    for (const legacyRoot of this.options.legacyRoots ?? []) {
      try {
        await rm(legacyRoot, { recursive: true, force: true })
      }
      catch (error) {
        this.options.logger?.warn('清理旧 Agent 日志失败', error)
      }
    }
    try {
      await this.enforceQuota()
    }
    catch (error) {
      this.options.logger?.warn('Agent Observability 配额清理失败', error)
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
  }

  beginTurn(meta: Parameters<AgentObservabilityPort['beginTurn']>[0]): AgentTurnRecorder {
    if (!this.enabled)
      return NOOP_RECORDER

    const traceId = randomUUID()
    const key = turnKey(meta.conversationId, meta.turnId)
    const filePath = this.getTurnPath(meta.conversationId, meta.turnId)
    void rm(filePath.replace(/\.jsonl$/, '.expired'), { force: true }).catch(() => {})
    let sequence = 0
    let finished = false
    let previousModelRequest: unknown | undefined
    const startedAt = Date.now()
    this.activeTurns.add(key)
    this.runtimeTurns.set(key, {
      meta,
      traceId,
      startedAt,
      spanCounts: { modelRequests: 0, policyDecisions: 0, toolCalls: 0, contextEvents: 0 },
    })

    const enqueue = (record: AgentObservabilityRecordInput, terminal = false) => {
      if (finished || this.discardedTurns.has(key) || (!terminal && this.stoppedTurns.has(key)))
        return undefined
      const fullRecord = {
        ...redactObservabilityEvidence(record) as typeof record,
        schemaVersion: 1 as const,
        sequence: sequence++,
        recordedAt: Date.now(),
        traceId,
        recordId: randomUUID(),
      } as AgentObservabilityRecord
      this.enqueueRecord(meta.conversationId, meta.turnId, fullRecord, filePath, terminal)
      return fullRecord
    }

    enqueue({
      recordType: 'trace-started',
      conversationId: meta.conversationId,
      turnId: meta.turnId,
      taskId: meta.taskId,
      source: meta.source,
      startedAt,
      metadata: meta.source,
    })

    const startSpan = (spanKind: TraceSpanKind, input: unknown, parentSpanId?: string) => {
      const spanId = randomUUID()
      const runtime = this.runtimeTurns.get(key)
      if (runtime) {
        if (spanKind === 'model-request')
          runtime.spanCounts.modelRequests++
        else if (spanKind === 'policy-decision')
          runtime.spanCounts.policyDecisions++
        else
          runtime.spanCounts.toolCalls++
      }
      const redactedInput = redactObservabilityEvidence(input)
      const storedInput = spanKind === 'model-request'
        ? createContextSnapshot(previousModelRequest, redactedInput)
        : redactedInput
      if (spanKind === 'model-request')
        previousModelRequest = redactedInput
      enqueue({ recordType: 'span-started', spanId, parentSpanId, spanKind, startedAt: Date.now(), input: storedInput })
      let completed = false
      const complete = (status: TraceSpanStatus, output?: unknown, error?: unknown) => {
        if (completed)
          return
        completed = true
        enqueue({ recordType: 'span-completed', spanId, parentSpanId, spanKind, status, endedAt: Date.now(), output, error })
      }
      return {
        id: spanId,
        complete(output?: unknown) {
          const candidate = output as { status?: TraceSpanStatus } | undefined
          complete(candidate?.status ?? 'success', output)
        },
        fail(error: unknown) { complete('failed', undefined, error) },
        cancel(reason?: unknown) { complete('cancelled', reason) },
      }
    }

    return {
      startModelRequest: input => startSpan('model-request', input),
      startToolCall: (input, parentSpanId) => startSpan('tool-call', input, parentSpanId),
      startPolicyDecision: (input, parentSpanId) => startSpan('policy-decision', input, parentSpanId),
      recordContextEvent: (event) => {
        const candidate = event as { kind?: ContextEventKind }
        // 调用方必须提供明确的 event kind，不允许隐式 fallback
        const eventKind = candidate.kind
        if (!eventKind) {
          this.options.logger?.warn('Agent Observability: 缺少 context event kind，已跳过记录')
          return
        }
        const runtime = this.runtimeTurns.get(key)
        if (runtime)
          runtime.spanCounts.contextEvents++
        enqueue({ recordType: 'context-event', eventKind, evidence: event })
      },
      finish: (result) => {
        if (finished)
          return
        const endedAt = Date.now()
        const runtime = this.runtimeTurns.get(key)
        if (runtime) {
          runtime.status = result.status
          runtime.endedAt = endedAt
          runtime.errorSummary = buildTerminalErrorSummary(redactObservabilityEvidence(result.error))
        }
        enqueue({
          recordType: 'trace-completed',
          status: result.status,
          endedAt,
          result: result.output,
          error: result.error,
        }, true)
        finished = true
        this.activeTurns.delete(key)
        if (this.discardedTurns.delete(key)) {
          this.runtimeTurns.delete(key)
          this.runtimeIncomplete.delete(key)
          return
        }
        this.maintenance = this.maintenance
          .then(async () => {
            try {
              await this.flush()
              const persisted = await this.parseTurn(filePath)
              const terminalPersisted = persisted?.records.some(record => record.recordType === 'trace-completed') ?? false
              const persistedIncomplete = new Set(persisted?.records
                .filter(record => record.recordType === 'trace-incomplete')
                .map(record => record.reason))
              const runtimeIncompletePersisted = [...(this.runtimeIncomplete.get(key) ?? [])]
                .every(reason => persistedIncomplete.has(reason))
              if (!this.runtimeIncomplete.get(key)?.has('disk') && terminalPersisted && runtimeIncompletePersisted) {
                this.runtimeTurns.delete(key)
                this.runtimeIncomplete.delete(key)
                this.stoppedTurns.delete(key)
                this.overflowMarkers.delete(key)
                this.overflowSequences.delete(key)
              }
              await this.enforceQuota()
            }
            finally {
              this.options.onTurnSettled?.({ conversationId: meta.conversationId, turnId: meta.turnId })
            }
          })
          .catch(error => this.options.logger?.warn('Agent Observability 终态刷盘或配额清理失败', error))
      },
    }
  }

  async listTurns(conversationId: string): Promise<AgentTurnSummary[]> {
    await this.flush()
    const conversationDir = this.getConversationPath(conversationId)
    let entries: Dirent[] = []
    try {
      entries = await readdir(conversationDir, { withFileTypes: true })
    }
    catch {}
    const summaries = await Promise.all(entries
      .filter(entry => entry.isFile() && (entry.name.endsWith('.jsonl') || entry.name.endsWith('.expired')))
      .map(async (entry): Promise<AgentTurnSummary> => {
        const turnId = decodeURIComponent(entry.name.replace(/\.(?:jsonl|expired)$/, ''))
        const filePath = path.join(conversationDir, entry.name)
        if (entry.name.endsWith('.expired')) {
          return { availability: 'expired', conversationId, turnId, traceFilePath: filePath, message: 'Trace 已过期' }
        }
        const parsed = await this.parseTurn(filePath)
        return parsed?.summary ?? { availability: 'unsupported', conversationId, turnId, traceFilePath: filePath, message: '不支持的 Trace schema' }
      }))
    const knownTurnIds = new Set(summaries.map(summary => summary.turnId))
    for (const [key, state] of this.runtimeTurns) {
      if (state.meta.conversationId !== conversationId || knownTurnIds.has(state.meta.turnId))
        continue
      if ((this.runtimeIncomplete.get(key)?.size ?? 0) > 0)
        summaries.push(this.createRuntimeSummary(key, state))
    }
    return summaries.sort((a, b) => {
      const left = a.availability === 'available' ? a.startedAt : 0
      const right = b.availability === 'available' ? b.startedAt : 0
      return right - left
    })
  }

  async getTurnTimeline(turn: AgentTurnIdentity): Promise<AgentTurnTimeline | null> {
    await this.flush()
    const parsed = await this.parseTurn(this.getTurnPath(turn.conversationId, turn.turnId))
    if (!parsed) {
      const key = turnKey(turn.conversationId, turn.turnId)
      const runtime = this.runtimeTurns.get(key)
      if (runtime) {
        const summary = this.createRuntimeSummary(key, runtime)
        return summary.lifecycle === 'completed' ? { summary, items: [] } : null
      }
      return null
    }
    if (parsed.summary.lifecycle === 'collecting')
      return null
    const completed = new Map(parsed.records
      .filter(record => record.recordType === 'span-completed')
      .map(record => [record.spanId, record]))
    const items: AgentTurnTimeline['items'] = []
    for (const record of parsed.records) {
      if (record.recordType === 'span-started') {
        const end = completed.get(record.spanId)
        items.push({
          type: 'span',
          recordId: record.recordId,
          spanId: record.spanId,
          parentSpanId: record.parentSpanId,
          kind: record.spanKind,
          status: end?.status,
          startedAt: record.startedAt,
          endedAt: end?.endedAt,
          durationMs: end ? Math.max(0, end.endedAt - record.startedAt) : undefined,
          summary: end ? buildSpanSummary(record.spanKind, record.input, end.output, end.error, end.status) : undefined,
        })
      }
      else if (record.recordType === 'context-event') {
        items.push({ type: 'context-event', recordId: record.recordId, kind: record.eventKind, recordedAt: record.recordedAt })
      }
    }
    return { summary: parsed.summary, items }
  }

  async getEvidence(turn: AgentTurnIdentity & { recordId: string }): Promise<AgentObservabilityEvidence | null> {
    await this.flush()
    const parsed = await this.parseTurn(this.getTurnPath(turn.conversationId, turn.turnId))
    if (!parsed || parsed.summary.lifecycle === 'collecting')
      return null
    const record = parsed.records.find(item => item.recordId === turn.recordId)
    if (!record)
      return null
    const records = record.recordType === 'span-started'
      ? parsed.records.filter(item => item.recordId === turn.recordId || (item.recordType === 'span-completed' && item.spanId === record.spanId))
      : [record]
    return { recordId: turn.recordId, records }
  }

  async deleteConversation(conversationId: string): Promise<void> {
    this.discardRuntimeTurns(state => state.meta.conversationId === conversationId)
    await this.flush()
    await rm(this.getConversationPath(conversationId), { recursive: true, force: true })
  }

  async clearAll(): Promise<void> {
    this.discardRuntimeTurns(() => true)
    await this.flush()
    await rm(this.options.rootDir, { recursive: true, force: true })
    await mkdir(this.options.rootDir, { recursive: true })
    this.runtimeIncomplete.clear()
  }

  async flush(): Promise<void> {
    while (this.draining || this.queue.length > 0) {
      if (!this.draining)
        this.scheduleDrain()
      await this.draining
    }
  }

  async dispose(): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined
    const completed = await Promise.race([
      Promise.all([this.flush(), this.maintenance]).then(() => true),
      new Promise<false>((resolve) => {
        timeout = setTimeout(resolve, this.options.flushTimeoutMs ?? DEFAULT_FLUSH_TIMEOUT_MS, false)
      }),
    ])
    if (timeout)
      clearTimeout(timeout)
    if (!completed)
      this.options.logger?.warn('Agent Observability 退出刷盘超时，剩余证据将在进程退出时丢失')
  }

  private enqueueRecord(conversationId: string, turnId: string, record: AgentObservabilityRecord, filePath: string, terminal = false): void {
    const key = turnKey(conversationId, turnId)
    const limit = this.options.queueByteLimit ?? DEFAULT_QUEUE_BYTES
    const line = `${JSON.stringify(record)}\n`
    const bytes = Buffer.byteLength(line)
    if (this.queueBytes + bytes <= limit) {
      this.queue.push({ key, filePath, line, bytes, recordType: record.recordType })
      this.queueBytes += bytes
      this.scheduleDrain()
      return
    }

    this.markIncomplete(key, 'queue-overflow')
    this.rememberOverflowSequence(key, record.sequence)
    this.stoppedTurns.add(key)
    this.options.logger?.warn('Agent Observability 队列溢出，已停止当前 Turn 采集', { conversationId, turnId })

    if (terminal) {
      this.enqueueOverflowTerminal(key, record, filePath, limit)
      this.scheduleDrain()
      return
    }

    if (!this.overflowMarkers.has(key)) {
      const overflow = this.overflowSequences.get(key)!
      const marker = createOverflowMarker(record, overflow.first, overflow.last)
      const markerLine = `${JSON.stringify(marker)}\n`
      const markerBytes = Buffer.byteLength(markerLine)
      if (this.queueBytes + markerBytes <= limit) {
        this.queue.push({ key, filePath, line: markerLine, bytes: markerBytes, recordType: 'trace-incomplete' })
        this.queueBytes += markerBytes
        this.overflowMarkers.add(key)
      }
    }
    this.scheduleDrain()
  }

  private enqueueOverflowTerminal(key: string, record: AgentObservabilityRecord, filePath: string, limit: number): void {
    const compactTerminal = omitTerminalEvidence(record)
    const queuedMarkerIndex = this.queue.findIndex(item => item.key === key && item.recordType === 'trace-incomplete')
    if (this.overflowMarkers.has(key) && queuedMarkerIndex === -1) {
      const terminalLine = `${JSON.stringify(compactTerminal)}\n`
      const terminalBytes = Buffer.byteLength(terminalLine)
      if (this.queueBytes + terminalBytes <= limit) {
        this.queue.push({ key, filePath, line: terminalLine, bytes: terminalBytes, recordType: 'trace-completed' })
        this.queueBytes += terminalBytes
      }
      return
    }

    const overflow = this.overflowSequences.get(key)!
    const queuedMarker = queuedMarkerIndex >= 0 ? this.queue[queuedMarkerIndex] : undefined
    const markerRecord = queuedMarker
      ? JSON.parse(queuedMarker.line.trim()) as Extract<AgentObservabilityRecord, { recordType: 'trace-incomplete' }>
      : undefined
    const candidates = this.queue
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.key === key && item.recordType !== 'trace-started' && item.recordType !== 'trace-incomplete' && item.recordType !== 'overflow-terminal')
      .reverse()
    const removed: Array<{ item: QueuedRecord, index: number, sequence: number }> = []
    let controlLine = ''
    let controlBytes = 0
    while (true) {
      const removedSequences = removed.map(item => item.sequence)
      const markerSequence = Math.min(markerRecord?.sequence ?? overflow.first, overflow.first, ...removedSequences)
      const lastDroppedSequence = Math.max(markerRecord?.lastDroppedSequence ?? overflow.last, overflow.last, ...removedSequences)
      const marker = createOverflowMarker(record, markerSequence, lastDroppedSequence)
      const terminal = { ...compactTerminal, sequence: markerSequence + 1 }
      controlLine = `${JSON.stringify(marker)}\n${JSON.stringify(terminal)}\n`
      controlBytes = Buffer.byteLength(controlLine)
      const freedBytes = (queuedMarker?.bytes ?? 0) + removed.reduce((sum, item) => sum + item.item.bytes, 0)
      if (this.queueBytes - freedBytes + controlBytes <= limit)
        break
      const candidate = candidates.shift()
      if (!candidate)
        return
      const [raw] = candidate.item.line.trim().split('\n')
      removed.push({ ...candidate, sequence: (JSON.parse(raw) as AgentObservabilityRecord).sequence })
    }

    const indexes = [...removed.map(item => item.index), ...(queuedMarkerIndex >= 0 ? [queuedMarkerIndex] : [])].sort((a, b) => b - a)
    for (const index of indexes) {
      const [item] = this.queue.splice(index, 1)
      this.queueBytes -= item.bytes
    }
    this.queue.push({ key, filePath, line: controlLine, bytes: controlBytes, recordType: 'overflow-terminal' })
    this.queueBytes += controlBytes
    this.overflowMarkers.add(key)
  }

  private scheduleDrain(): void {
    if (this.draining)
      return
    this.draining = this.drainQueue().finally(() => {
      this.draining = null
      if (this.queue.length > 0)
        this.scheduleDrain()
    })
  }

  private async drainQueue(): Promise<void> {
    while (this.queue.length > 0) {
      const item = this.queue.shift()!
      this.queueBytes -= item.bytes
      if (this.runtimeIncomplete.get(item.key)?.has('disk'))
        continue
      try {
        await mkdir(path.dirname(item.filePath), { recursive: true })
        const handle = await open(item.filePath, 'a')
        try {
          await handle.write(item.line)
        }
        finally {
          await handle.close()
        }
      }
      catch (error) {
        this.markIncomplete(item.key, 'disk')
        this.stoppedTurns.add(item.key)
        this.options.logger?.error('写入 Agent Observability 证据失败', error)
      }
    }
  }

  private markIncomplete(key: string, reason: TraceIncompleteReason): void {
    const reasons = this.runtimeIncomplete.get(key) ?? new Set<TraceIncompleteReason>()
    reasons.add(reason)
    this.runtimeIncomplete.set(key, reasons)
  }

  private rememberOverflowSequence(key: string, sequence: number): void {
    const current = this.overflowSequences.get(key)
    this.overflowSequences.set(key, current
      ? { first: Math.min(current.first, sequence), last: Math.max(current.last, sequence) }
      : { first: sequence, last: sequence })
  }

  private discardRuntimeTurns(predicate: (state: RuntimeTurnState) => boolean): void {
    for (const [key, state] of this.runtimeTurns) {
      if (!predicate(state))
        continue
      if (this.activeTurns.has(key)) {
        this.discardedTurns.add(key)
        this.stoppedTurns.add(key)
      }
      else {
        this.stoppedTurns.delete(key)
      }
      this.activeTurns.delete(key)
      this.runtimeTurns.delete(key)
      this.runtimeIncomplete.delete(key)
      this.overflowMarkers.delete(key)
      this.overflowSequences.delete(key)
    }
  }

  private createRuntimeSummary(key: string, state: RuntimeTurnState): AvailableAgentTurnSummary {
    const base = {
      availability: 'available',
      conversationId: state.meta.conversationId,
      turnId: state.meta.turnId,
      traceId: state.traceId,
      source: state.meta.source,
      taskId: state.meta.taskId,
      startedAt: state.startedAt,
      spanCounts: { ...state.spanCounts },
    } as const
    if (!state.status) {
      return {
        ...base,
        lifecycle: 'collecting',
      } satisfies CollectingAgentTurnSummary
    }
    return {
      ...base,
      lifecycle: 'completed',
      status: state.status,
      completeness: 'incomplete',
      incompleteReasons: [...(this.runtimeIncomplete.get(key) ?? [])],
      endedAt: state.endedAt,
      durationMs: state.endedAt ? Math.max(0, state.endedAt - state.startedAt) : undefined,
      errorSummary: state.errorSummary,
    } satisfies CompletedAgentTurnSummary
  }

  private async parseTurn(filePath: string): Promise<ParsedTurn | null> {
    let content: string
    try {
      content = await readFile(filePath, 'utf8')
    }
    catch {
      return null
    }
    const records: AgentObservabilityRecord[] = []
    const incompleteReasons = new Set<TraceIncompleteReason>()
    let previousModelRequest: unknown | undefined
    let expectedSequence = 0
    for (const line of content.split('\n')) {
      if (!line.trim())
        continue
      let raw: unknown
      try {
        raw = JSON.parse(line)
      }
      catch {
        incompleteReasons.add('disk')
        break
      }
      const parsed = AgentObservabilityRecordSchema.safeParse(raw)
      if (!parsed.success)
        return null
      if (parsed.data.sequence !== expectedSequence) {
        incompleteReasons.add('disk')
        break
      }
      expectedSequence++
      let record = parsed.data
      if (record.recordType === 'span-started' && record.spanKind === 'model-request') {
        try {
          previousModelRequest = applyContextSnapshot(previousModelRequest, record.input as never)
          record = { ...record, input: previousModelRequest }
        }
        catch {
          incompleteReasons.add('corrupt-delta')
          break
        }
      }
      if (record.recordType === 'trace-incomplete')
        incompleteReasons.add(record.reason)
      records.push(record)
    }
    const started = records.find(record => record.recordType === 'trace-started')
    if (!started || started.recordType !== 'trace-started')
      return null
    let terminal: Extract<AgentObservabilityRecord, { recordType: 'trace-completed' }> | undefined
    for (let index = records.length - 1; index >= 0; index--) {
      const candidate = records[index]
      if (candidate.recordType === 'trace-completed') {
        terminal = candidate
        break
      }
    }
    if (terminal && hasSpanMismatch(records))
      incompleteReasons.add('span-mismatch')
    for (const reason of this.runtimeIncomplete.get(turnKey(started.conversationId, started.turnId)) ?? [])
      incompleteReasons.add(reason)
    const runtime = this.runtimeTurns.get(turnKey(started.conversationId, started.turnId))
    const spanCounts = { modelRequests: 0, policyDecisions: 0, toolCalls: 0, contextEvents: 0 }
    for (const record of records) {
      if (record.recordType === 'span-started') {
        if (record.spanKind === 'model-request')
          spanCounts.modelRequests++
        else if (record.spanKind === 'policy-decision')
          spanCounts.policyDecisions++
        else spanCounts.toolCalls++
      }
      else if (record.recordType === 'context-event') {
        spanCounts.contextEvents++
      }
    }
    const base = {
      availability: 'available' as const,
      conversationId: started.conversationId,
      turnId: started.turnId,
      traceId: started.traceId,
      source: started.source,
      taskId: started.taskId,
      startedAt: started.startedAt,
      spanCounts,
      traceFilePath: filePath,
    }
    if (!terminal && runtime && !runtime.status) {
      return {
        records,
        summary: {
          ...base,
          lifecycle: 'collecting',
        },
      }
    }
    if (!terminal && incompleteReasons.size === 0)
      incompleteReasons.add('missing-terminal')
    const status = terminal?.status ?? runtime?.status ?? 'interrupted'
    const endedAt = terminal?.endedAt ?? runtime?.endedAt
    return {
      records,
      summary: {
        ...base,
        lifecycle: 'completed',
        status,
        completeness: terminal && incompleteReasons.size === 0 ? 'complete' : 'incomplete',
        incompleteReasons: [...incompleteReasons],
        endedAt,
        durationMs: endedAt ? Math.max(0, endedAt - started.startedAt) : undefined,
        errorSummary: buildTerminalErrorSummary(terminal?.error) ?? runtime?.errorSummary,
      },
    }
  }

  private async enforceQuota(): Promise<void> {
    const quota = this.options.quotaBytes ?? DEFAULT_QUOTA_BYTES
    const target = Math.min(this.options.quotaTargetBytes ?? DEFAULT_QUOTA_TARGET_BYTES, quota)
    const files = await listJsonlFiles(this.options.rootDir)
    const total = files.reduce((sum, file) => sum + file.size, 0)
    if (total <= quota)
      return
    let remaining = total
    for (const file of files.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
      if (remaining <= target)
        break
      if (this.activeTurns.has(file.key))
        continue
      const parsed = await this.parseTurn(file.path)
      if (!parsed || parsed.summary.lifecycle === 'collecting' || parsed.summary.status === 'interrupted' || parsed.summary.completeness !== 'complete')
        continue
      await rm(file.path, { force: true })
      await writeFile(file.path.replace(/\.jsonl$/, '.expired'), '')
      remaining -= file.size
    }
  }

  private getConversationPath(conversationId: string): string {
    return path.join(this.options.rootDir, encodeURIComponent(conversationId))
  }

  private getTurnPath(conversationId: string, turnId: string): string {
    return path.join(this.getConversationPath(conversationId), `${encodeURIComponent(turnId)}.jsonl`)
  }
}

export function createAgentObservability(options: AgentObservabilityOptions): AgentObservability {
  return new AgentObservability(options)
}

function turnKey(conversationId: string, turnId: string): string {
  return `${conversationId}\0${turnId}`
}

/** 从 span-completed 的 output/error 中提取一行摘要，供时间线行内展示。 */
function buildSpanSummary(spanKind: TraceSpanKind, input: unknown, output: unknown, error: unknown, status: TraceSpanStatus | undefined): string {
  if (spanKind === 'model-request') {
    const out = asRecord(output)
    const toolCalls = asArray(out?.toolCalls)
    if (toolCalls && toolCalls.length > 0) {
      const names = toolCalls
        .map(tc => asString(asRecord(tc)?.toolName))
        .filter((name): name is string => Boolean(name))
      return names.length > 0 ? `调用 ${names.join(', ')}` : `请求 ${toolCalls.length} 个工具`
    }
    const text = asString(out?.text)
    if (text)
      return `回复 "${truncate(text, 60)}"`
    if (out?.finishReason)
      return `结束（${String(out.finishReason)}）`
    const errorText = extractErrorText(error)
    if (errorText)
      return `错误: ${truncate(errorText, 60)}`
    return ''
  }
  if (spanKind === 'tool-call') {
    const envelope = asRecord(output) ?? asRecord(error)
    const toolName = asString(asRecord(input)?.toolName) ?? ''
    const exitCode = asNumber(envelope?.exitCode)
    const success = status === 'success' || exitCode === 0
    const label = toolName || '工具'
    if (success)
      return exitCode != null ? `${label} 成功 · 退出码 ${exitCode}` : `${label} 成功`
    const errorText = extractErrorText(error) ?? asString(envelope?.error)
    if (errorText)
      return `${label} 失败: ${truncate(errorText, 60)}`
    return `${label} 失败`
  }
  if (spanKind === 'policy-decision') {
    const out = asRecord(output)
    const outcome = asString(out?.outcome) ?? status ?? ''
    const toolName = asString(asRecord(input)?.toolName) ?? ''
    const prefix = toolName ? `${toolName}: ` : ''
    if (outcome === 'allow')
      return `${prefix}允许`
    if (outcome === 'block')
      return `${prefix}已阻止`
    if (outcome === 'approval')
      return `${prefix}需审批`
    const reason = asString(out?.reason)
    if (reason)
      return `${prefix}${truncate(reason, 40)}`
    if (outcome)
      return `${prefix}${outcome}`
    return prefix || String(outcome)
  }
  return ''
}

function extractErrorText(error: unknown): string | undefined {
  if (typeof error === 'string')
    return error
  const record = asRecord(error)
  if (!record)
    return undefined
  if (typeof record.error === 'string')
    return record.error
  if (typeof record.message === 'string' && record.message)
    return record.message
  return asString(record.name)
}

function buildTerminalErrorSummary(error: unknown): string | undefined {
  const text = extractErrorText(error)
  return text ? truncate(text, 200) : undefined
}

function hasSpanMismatch(records: AgentObservabilityRecord[]): boolean {
  const started = new Map<string, Extract<AgentObservabilityRecord, { recordType: 'span-started' }>>()
  const completed = new Map<string, Extract<AgentObservabilityRecord, { recordType: 'span-completed' }>>()
  for (const record of records) {
    if (record.recordType === 'span-started') {
      if (started.has(record.spanId))
        return true
      started.set(record.spanId, record)
    }
    else if (record.recordType === 'span-completed') {
      if (completed.has(record.spanId))
        return true
      completed.set(record.spanId, record)
    }
  }
  if (started.size !== completed.size)
    return true
  for (const [spanId, start] of started) {
    const end = completed.get(spanId)
    if (!end || end.spanKind !== start.spanKind || end.parentSpanId !== start.parentSpanId)
      return true
  }
  return false
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function omitTerminalEvidence(record: AgentObservabilityRecord): AgentObservabilityRecord {
  if (record.recordType !== 'trace-completed')
    return record
  const { error: _error, result: _result, ...terminal } = record
  return terminal
}

function createOverflowMarker(record: AgentObservabilityRecord, sequence: number, lastDroppedSequence: number): AgentObservabilityRecord {
  return {
    schemaVersion: 1,
    sequence,
    recordedAt: Date.now(),
    traceId: record.traceId,
    recordId: randomUUID(),
    recordType: 'trace-incomplete',
    reason: 'queue-overflow',
    firstDroppedSequence: sequence,
    lastDroppedSequence,
  }
}

async function listJsonlFiles(root: string): Promise<Array<{ path: string, size: number, mtimeMs: number, key: string }>> {
  let conversations
  try {
    conversations = await readdir(root, { withFileTypes: true })
  }
  catch {
    return []
  }
  const result: Array<{ path: string, size: number, mtimeMs: number, key: string }> = []
  for (const conversation of conversations) {
    if (!conversation.isDirectory())
      continue
    const conversationPath = path.join(root, conversation.name)
    const turns = await readdir(conversationPath, { withFileTypes: true })
    for (const turn of turns) {
      if (!turn.isFile() || !turn.name.endsWith('.jsonl'))
        continue
      const filePath = path.join(conversationPath, turn.name)
      const info = await stat(filePath)
      result.push({
        path: filePath,
        size: info.size,
        mtimeMs: info.mtimeMs,
        key: turnKey(decodeURIComponent(conversation.name), decodeURIComponent(turn.name.slice(0, -6))),
      })
    }
  }
  return result
}
