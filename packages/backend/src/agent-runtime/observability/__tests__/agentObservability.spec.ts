import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAgentObservability } from '../agentObservability'
import { redactObservabilityEvidence } from '../redaction'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function createRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'ant-chat-observability-'))
  roots.push(root)
  return root
}

function begin(module: ReturnType<typeof createAgentObservability>, turnId = 'turn-1') {
  return module.beginTurn({
    conversationId: 'conversation-1',
    turnId,
    taskId: `task-${turnId}`,
    source: { type: 'interactive' },
  })
}

describe('agent Observability module', () => {
  it('通过公共查询重建多次模型请求并保留增删改与顺序变化', async () => {
    const root = await createRoot()
    const module = createAgentObservability({ rootDir: root })
    await module.initialize()
    module.setEnabled(true)
    const recorder = begin(module)
    const first = {
      messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'A' }] }, { role: 'assistant' as const, content: [{ type: 'text' as const, text: 'B' }] }],
      modelSettings: { model: 'model-1', systemPrompt: 'system', temperature: 0.2, maxOutputTokens: 100 },
    }
    const second = {
      messages: [{ role: 'assistant' as const, content: [{ type: 'text' as const, text: 'B2' }] }, { role: 'user' as const, content: [{ type: 'text' as const, text: 'C' }] }, { role: 'user' as const, content: [{ type: 'text' as const, text: 'A' }] }],
      modelSettings: { model: 'model-1', systemPrompt: 'system', temperature: 0.7 },
      tools: [{ name: 'read', source: 'native' as const, inputSchema: { type: 'object' as const, properties: {}, required: [] } }],
    }
    recorder.startModelRequest(first).complete({ text: 'first' })
    recorder.startModelRequest(second).complete({ text: 'second' })
    recorder.finish({ status: 'success' })
    await module.flush()

    const timeline = await module.getTurnTimeline({ conversationId: 'conversation-1', turnId: 'turn-1' })
    const modelSpans = timeline?.items.filter(item => item.type === 'span' && item.kind === 'model-request') ?? []
    expect(modelSpans).toHaveLength(2)
    const evidence = await Promise.all(modelSpans.map(span => module.getEvidence({ conversationId: 'conversation-1', turnId: 'turn-1', recordId: span.recordId })))
    expect(evidence.map((item) => {
      const record = item?.records.find(record => record.recordType === 'span-started')
      return record?.recordType === 'span-started' ? record.input : undefined
    })).toEqual([first, second])
    expect(evidence[0]?.records).toEqual(expect.arrayContaining([
      expect.objectContaining({ recordType: 'span-started' }),
      expect.objectContaining({ recordType: 'span-completed', output: { text: 'first' } }),
    ]))
  })

  it('只在 Turn 终态完成持久化后发送一次失效通知', async () => {
    const root = await createRoot()
    const onTurnSettled = vi.fn()
    const module = createAgentObservability({ rootDir: root, onTurnSettled })
    await module.initialize()
    module.setEnabled(true)
    const recorder = begin(module)
    recorder.startModelRequest({ messages: [], modelSettings: { model: 'model-1' } } as never).complete({ text: '完成' })
    await module.flush()
    expect(onTurnSettled).not.toHaveBeenCalled()

    recorder.finish({ status: 'success' })
    await module.dispose()

    expect(onTurnSettled).toHaveBeenCalledOnce()
    expect(onTurnSettled).toHaveBeenCalledWith({ conversationId: 'conversation-1', turnId: 'turn-1' })
    await expect(module.listTurns('conversation-1')).resolves.toEqual([
      expect.objectContaining({ lifecycle: 'completed', status: 'success' }),
    ])
  })

  it('敏感值在进入异步队列前统一脱敏，磁盘与查询均不含明文', async () => {
    const root = await createRoot()
    const module = createAgentObservability({ rootDir: root })
    await module.initialize()
    module.setEnabled(true)
    const recorder = begin(module)
    const span = recorder.startToolCall({
      authorization: 'Bearer raw-token',
      nested: { password: 'raw-password' },
      ref: { kind: 'secret_ref', id: 'secret-id', scope: 'turn' },
    })
    span.fail({ message: 'boom', apiKey: 'raw-key' })
    recorder.finish({ status: 'failed', error: { cookie: 'raw-cookie' } })
    await module.flush()

    const file = await readFile(path.join(root, 'conversation-1', 'turn-1.jsonl'), 'utf8')
    expect(file).not.toMatch(/raw-token|raw-password|raw-key|raw-cookie|secret-id/)
    expect(file).toContain('[secret]')
    expect(file).toContain('[secret-ref]')
  })

  it('基于脱敏后的模型请求计算 delta 并完整重建连续请求', async () => {
    const root = await createRoot()
    const module = createAgentObservability({ rootDir: root })
    await module.initialize()
    module.setEnabled(true)
    const recorder = begin(module)
    recorder.startModelRequest({
      messages: [],
      modelSettings: { model: 'model-1', systemPrompt: 'system' },
      authorization: 'Bearer raw-token',
      apiKey: 'raw-key',
    } as never).complete()
    recorder.startModelRequest({
      messages: [{ role: 'user', content: [{ type: 'text', text: '继续' }] }],
      modelSettings: { model: 'model-1', systemPrompt: 'system' },
      authorization: 'Bearer raw-token',
      apiKey: 'raw-key',
    } as never).complete()
    recorder.finish({ status: 'success' })
    await module.dispose()

    const timeline = await module.getTurnTimeline({ conversationId: 'conversation-1', turnId: 'turn-1' })
    expect(timeline?.summary).toMatchObject({ completeness: 'complete', incompleteReasons: [] })
    const modelSpans = timeline?.items.filter(item => item.type === 'span' && item.kind === 'model-request') ?? []
    const evidence = await Promise.all(modelSpans.map(span => module.getEvidence({ conversationId: 'conversation-1', turnId: 'turn-1', recordId: span.recordId })))
    expect(evidence.map(item => item?.records.find(record => record.recordType === 'span-started'))).toEqual([
      expect.objectContaining({ input: expect.objectContaining({ authorization: '[secret]', apiKey: '[secret]' }) }),
      expect.objectContaining({ input: expect.objectContaining({ authorization: '[secret]', apiKey: '[secret]', messages: [{ role: 'user', content: [{ type: 'text', text: '继续' }] }] }) }),
    ])
  })

  it('脱敏保留重复引用并序列化 Error 证据', () => {
    const shared = { value: 'same' }
    const error = new Error('Bearer raw-token')
    const errorWithCause = error as Error & { cause?: unknown }
    errorWithCause.cause = { password: 'raw-password' }

    expect(redactObservabilityEvidence({ first: shared, second: shared, error })).toEqual({
      first: { value: 'same' },
      second: { value: 'same' },
      error: expect.objectContaining({
        name: 'Error',
        message: 'Bearer [secret]',
        cause: { password: '[secret]' },
      }),
    })
  })

  it('磁盘失败不会从 recorder 抛出且不会改变调用者结果', async () => {
    const root = await createRoot()
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const module = createAgentObservability({ rootDir: root, logger })
    await module.initialize()
    await rm(root, { recursive: true, force: true })
    await writeFile(root, '阻断目录创建')
    module.setEnabled(true)

    expect(() => {
      const recorder = begin(module)
      recorder.startToolCall({ tool: 'read' }).complete({ ok: true })
      recorder.finish({ status: 'success', output: '业务结果' })
    }).not.toThrow()
    await expect(module.flush()).resolves.toBeUndefined()
    expect(logger.error).toHaveBeenCalled()
    await expect(module.listTurns('conversation-1')).resolves.toEqual([
      expect.objectContaining({ availability: 'available', status: 'success', completeness: 'incomplete', incompleteReasons: ['disk'] }),
    ])
    await expect(module.getTurnTimeline({ conversationId: 'conversation-1', turnId: 'turn-1' })).resolves.toEqual(expect.objectContaining({
      items: [],
      summary: expect.objectContaining({ incompleteReasons: ['disk'] }),
    }))
  })

  it('磁盘失败时运行时错误摘要仍经过统一脱敏', async () => {
    const root = await createRoot()
    const module = createAgentObservability({ rootDir: root })
    await module.initialize()
    await rm(root, { recursive: true, force: true })
    await writeFile(root, '阻断目录创建')
    module.setEnabled(true)

    begin(module).finish({ status: 'failed', error: new Error('Bearer raw-token') })
    await module.flush()

    await expect(module.listTurns('conversation-1')).resolves.toEqual([
      expect.objectContaining({
        lifecycle: 'completed',
        status: 'failed',
        errorSummary: 'Bearer [secret]',
      }),
    ])
  })

  it('存储目录初始化失败不会阻断 runtime 启动', async () => {
    const root = await createRoot()
    const blockedRoot = path.join(root, 'blocked')
    await writeFile(blockedRoot, '不是目录')
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const module = createAgentObservability({ rootDir: blockedRoot, logger })

    await expect(module.initialize()).resolves.toBeUndefined()
    module.setEnabled(true)
    expect(() => begin(module).finish({ status: 'success' })).not.toThrow()
    await module.dispose()
    expect(logger.error).toHaveBeenCalledWith('初始化 Agent Observability 存储失败', expect.anything())
  })

  it('队列溢出后停止当前 Turn 采集并将完整性标记为 incomplete', async () => {
    const root = await createRoot()
    const module = createAgentObservability({ rootDir: root, queueByteLimit: 900 })
    await module.initialize()
    module.setEnabled(true)
    const recorder = begin(module)
    recorder.startToolCall({ payload: 'x'.repeat(5_000) })
    recorder.finish({ status: 'success' })
    await module.dispose()

    const reopened = createAgentObservability({ rootDir: root })
    await reopened.initialize()
    const [summary] = await reopened.listTurns('conversation-1')
    expect(summary).toMatchObject({ status: 'success', completeness: 'incomplete', incompleteReasons: ['queue-overflow'] })
  })

  it('超大终态不会突破队列上限，并保留最小真实状态', async () => {
    const root = await createRoot()
    const module = createAgentObservability({ rootDir: root, queueByteLimit: 1_000 })
    await module.initialize()
    module.setEnabled(true)
    const recorder = begin(module)
    recorder.finish({ status: 'failed', error: { detail: 'x'.repeat(10_000) } })
    await module.dispose()

    const file = await readFile(path.join(root, 'conversation-1', 'turn-1.jsonl'), 'utf8')
    expect(file).not.toContain('x'.repeat(1_000))
    expect(file.trim().split('\n').map(line => JSON.parse(line))).toEqual([
      expect.objectContaining({ sequence: 0, recordType: 'trace-started' }),
      expect.objectContaining({ sequence: 1, recordType: 'trace-incomplete', reason: 'queue-overflow' }),
      expect.objectContaining({ sequence: 2, recordType: 'trace-completed', status: 'failed' }),
    ])
    await expect(module.listTurns('conversation-1')).resolves.toEqual([
      expect.objectContaining({ status: 'failed', completeness: 'incomplete', incompleteReasons: ['queue-overflow'] }),
    ])
  })

  it('普通记录先溢出时原子重建 incomplete marker 与最小终态', async () => {
    const root = await createRoot()
    const module = createAgentObservability({ rootDir: root, queueByteLimit: 1_000 })
    await module.initialize()
    module.setEnabled(true)
    const recorder = begin(module)
    recorder.startToolCall({ detail: 'x'.repeat(10_000) })
    recorder.finish({ status: 'success', output: { detail: 'y'.repeat(10_000) } })
    await module.dispose()

    const file = await readFile(path.join(root, 'conversation-1', 'turn-1.jsonl'), 'utf8')
    expect(file.trim().split('\n').map(line => JSON.parse(line))).toEqual([
      expect.objectContaining({ sequence: 0, recordType: 'trace-started' }),
      expect.objectContaining({ sequence: 1, recordType: 'trace-incomplete', reason: 'queue-overflow' }),
      expect.objectContaining({ sequence: 2, recordType: 'trace-completed', status: 'success' }),
    ])
    await expect(module.listTurns('conversation-1')).resolves.toEqual([
      expect.objectContaining({ status: 'success', completeness: 'incomplete', incompleteReasons: ['queue-overflow'] }),
    ])
  })

  it('jsonl sequence 缺失、重复或乱序时停止可信重建并标记 incomplete', async () => {
    const root = await createRoot()
    const module = createAgentObservability({ rootDir: root })
    await module.initialize()
    module.setEnabled(true)
    const recorder = begin(module)
    recorder.startToolCall({ path: 'a' }).complete({ result: 'ok' })
    recorder.finish({ status: 'success' })
    await module.dispose()

    const filePath = path.join(root, 'conversation-1', 'turn-1.jsonl')
    const lines = (await readFile(filePath, 'utf8')).trim().split('\n')
    await writeFile(filePath, `${[lines[0], lines[1], lines[1], ...lines.slice(2)].join('\n')}\n`)

    const reopened = createAgentObservability({ rootDir: root })
    await reopened.initialize()
    await expect(reopened.listTurns('conversation-1')).resolves.toEqual([
      expect.objectContaining({ status: 'interrupted', completeness: 'incomplete', incompleteReasons: ['disk'] }),
    ])
  })

  it('仍在采集的 Turn 显示为 collecting 且不能读取时间线', async () => {
    const root = await createRoot()
    const module = createAgentObservability({ rootDir: root })
    await module.initialize()
    module.setEnabled(true)
    begin(module).recordContextEvent({ kind: 'steering', text: '继续' })
    await module.flush()

    await expect(module.listTurns('conversation-1')).resolves.toEqual([
      expect.objectContaining({ lifecycle: 'collecting' }),
    ])
    await expect(module.getTurnTimeline({ conversationId: 'conversation-1', turnId: 'turn-1' })).resolves.toBeNull()
  })

  it('重启后没有终态的 Trace 显示为 interrupted 与 incomplete', async () => {
    const root = await createRoot()
    const module = createAgentObservability({ rootDir: root })
    await module.initialize()
    module.setEnabled(true)
    begin(module).recordContextEvent({ kind: 'steering', text: '继续' })
    await module.flush()

    const reopened = createAgentObservability({ rootDir: root })
    await reopened.initialize()

    await expect(reopened.listTurns('conversation-1')).resolves.toEqual([
      expect.objectContaining({
        lifecycle: 'completed',
        status: 'interrupted',
        completeness: 'incomplete',
        incompleteReasons: ['missing-terminal'],
      }),
    ])
  })

  it('已结束的 Turn 缺少 Span 终态时标记 Trace 不完整', async () => {
    const root = await createRoot()
    const module = createAgentObservability({ rootDir: root })
    await module.initialize()
    module.setEnabled(true)
    const recorder = begin(module)
    recorder.startToolCall({ toolName: 'read_file' })
    recorder.finish({ status: 'failed', error: new Error('事件发送失败') })

    await expect(module.listTurns('conversation-1')).resolves.toEqual([
      expect.objectContaining({
        lifecycle: 'completed',
        status: 'failed',
        completeness: 'incomplete',
        incompleteReasons: ['span-mismatch'],
        errorSummary: '事件发送失败',
      }),
    ])
  })

  it('未知 schema 显示 unsupported，不伪解析为正常 Trace', async () => {
    const root = await createRoot()
    await mkdir(path.join(root, 'conversation-1'))
    await writeFile(path.join(root, 'conversation-1', 'turn-1.jsonl'), JSON.stringify({
      schemaVersion: 999,
      recordType: 'trace-started',
    }))
    const module = createAgentObservability({ rootDir: root })
    await module.initialize()

    await expect(module.listTurns('conversation-1')).resolves.toEqual([{
      availability: 'unsupported',
      conversationId: 'conversation-1',
      turnId: 'turn-1',
      traceFilePath: path.join(root, 'conversation-1', 'turn-1.jsonl'),
      message: '不支持的 Trace schema',
    }])
  })

  it('配额只淘汰最旧的完整非活跃 Turn，并留下 expired 事实', async () => {
    const root = await createRoot()
    const module = createAgentObservability({ rootDir: root, quotaBytes: 1_000, quotaTargetBytes: 400 })
    await module.initialize()
    module.setEnabled(true)
    const recorder = begin(module, 'turn-old')
    recorder.startToolCall({ payload: 'x'.repeat(2_000) }).complete({ ok: true })
    recorder.finish({ status: 'success' })
    await module.flush()
    await module.dispose()

    const reopened = createAgentObservability({ rootDir: root, quotaBytes: 1_000, quotaTargetBytes: 400 })
    await reopened.initialize()
    await expect(reopened.listTurns('conversation-1')).resolves.toEqual([
      expect.objectContaining({ availability: 'expired', turnId: 'turn-old' }),
    ])
  })

  it('永久删除与清除全部只删除对应证据目录', async () => {
    const root = await createRoot()
    const module = createAgentObservability({ rootDir: root })
    await module.initialize()
    module.setEnabled(true)
    for (const [conversationId, turnId] of [['conversation-1', 'turn-1'], ['conversation-2', 'turn-2']]) {
      const recorder = module.beginTurn({ conversationId, turnId, taskId: turnId, source: { type: 'interactive' } })
      recorder.finish({ status: 'success' })
    }
    await module.flush()

    await module.deleteConversation('conversation-1')
    await expect(module.listTurns('conversation-1')).resolves.toEqual([])
    await expect(module.listTurns('conversation-2')).resolves.toHaveLength(1)
    await module.clearAll()
    await expect(module.listTurns('conversation-2')).resolves.toEqual([])
  })

  it('永久删除与清除全部会停止活跃 recorder，后续记录不能复活目录', async () => {
    const root = await createRoot()
    const module = createAgentObservability({ rootDir: root })
    await module.initialize()
    module.setEnabled(true)

    const deleted = begin(module, 'turn-deleted')
    deleted.startToolCall({ step: 1 }).complete()
    await module.deleteConversation('conversation-1')
    deleted.startToolCall({ step: 2 }).complete()
    deleted.finish({ status: 'success' })
    await module.flush()
    await expect(module.listTurns('conversation-1')).resolves.toEqual([])

    const cleared = module.beginTurn({ conversationId: 'conversation-2', turnId: 'turn-cleared', taskId: 'task-cleared', source: { type: 'interactive' } })
    await module.clearAll()
    cleared.recordContextEvent({ kind: 'steering', text: '不得写回' })
    cleared.finish({ status: 'success' })
    await module.flush()
    await expect(module.listTurns('conversation-2')).resolves.toEqual([])
  })

  it('初始化时一次性删除旧日志目录', async () => {
    const root = await createRoot()
    const legacy = path.join(root, 'legacy-tasks')
    await writeFile(path.join(root, 'placeholder'), '')
    const module = createAgentObservability({ rootDir: path.join(root, 'observability'), legacyRoots: [legacy] })
    await mkdir(legacy)
    await writeFile(path.join(legacy, 'conversation.jsonl'), '旧日志')
    await module.initialize()
    await expect(readFile(path.join(legacy, 'conversation.jsonl'), 'utf8')).rejects.toThrow()
  })
})
