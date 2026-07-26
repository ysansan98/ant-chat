import type { AgentTurnSummary, AgentTurnTimeline } from '@ant-chat/shared'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { observabilityApi } from '@/api/observabilityApi'
import { ExecutionTracePanel } from './ExecutionTracePanel'

const eventBoundary = vi.hoisted(() => ({ handler: undefined as undefined | ((payload: { conversationId: string, turnId: string }) => void) }))

vi.mock('@/api/observabilityApi', () => ({
  observabilityApi: {
    listTurns: vi.fn(),
    getTurnTimeline: vi.fn(),
    getEvidence: vi.fn(),
    clearAll: vi.fn(),
  },
}))

vi.mock('@/api/transports/appEventSubscriptions', () => ({
  getAppEventSubscriptions: () => ({
    subscribe: (_channel: string, handler: typeof eventBoundary.handler) => {
      eventBoundary.handler = handler
      return () => {
        eventBoundary.handler = undefined
      }
    },
  }),
}))

const first = summary('turn-2', 2_000, 'success')
const second = summary('turn-1', 1_000, 'failed')

type AvailableAgentTurnSummary = Extract<AgentTurnSummary, { availability: 'available' }>
type CompletedAgentTurnSummary = Extract<AvailableAgentTurnSummary, { lifecycle: 'completed' }>
type CollectingAgentTurnSummary = Extract<AvailableAgentTurnSummary, { lifecycle: 'collecting' }>

describe('executionTracePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    eventBoundary.handler = undefined
    vi.mocked(observabilityApi.listTurns).mockResolvedValue([first, second])
    vi.mocked(observabilityApi.getTurnTimeline).mockImplementation(async (_conversationId, turnId) => timeline(turnId))
    vi.mocked(observabilityApi.getEvidence).mockResolvedValue({
      recordId: 'model-1',
      records: [{
        schemaVersion: 1,
        sequence: 1,
        recordedAt: 2_000,
        traceId: 'trace-turn-2',
        recordId: 'model-1',
        recordType: 'span-started',
        spanId: 'span-1',
        spanKind: 'model-request',
        startedAt: 2_000,
        input: { messages: [{ role: 'user', content: '真实请求' }] },
      }],
    })
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList)
  })

  it('关闭时不查询，打开后只加载摘要并默认展开最新 Turn', async () => {
    const view = render(<ExecutionTracePanel conversationId="conversation-1" isOpen={false} onClose={vi.fn()} />)
    expect(observabilityApi.listTurns).not.toHaveBeenCalled()
    expect(eventBoundary.handler).toBeUndefined()

    view.rerender(<ExecutionTracePanel conversationId="conversation-1" isOpen onClose={vi.fn()} />)

    expect(await screen.findByText('Turn turn-2')).toBeInTheDocument()
    expect(eventBoundary.handler).toBeTypeOf('function')
    expect(observabilityApi.listTurns).toHaveBeenCalledWith('conversation-1')
    expect(observabilityApi.getTurnTimeline).toHaveBeenCalledWith('conversation-1', 'turn-2')
    expect(observabilityApi.getEvidence).not.toHaveBeenCalled()

    view.rerender(<ExecutionTracePanel conversationId="conversation-1" isOpen={false} onClose={vi.fn()} />)
    expect(eventBoundary.handler).toBeUndefined()
  })

  it('执行中的 Turn 可见但不可展开，完成后才按需读取时间线', async () => {
    vi.mocked(observabilityApi.listTurns).mockResolvedValue([collectingSummary('turn-running', 3_000), first])
    render(<ExecutionTracePanel conversationId="conversation-1" isOpen onClose={vi.fn()} />)

    expect(await screen.findByText('执行中，完成后可查看')).toBeInTheDocument()
    expect(screen.getByText('Turn turn-running')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Turn turn-running/ })).not.toBeInTheDocument()
    expect(observabilityApi.getTurnTimeline).not.toHaveBeenCalledWith('conversation-1', 'turn-running')
  })

  it('失败 Turn 展示终态错误摘要', async () => {
    vi.mocked(observabilityApi.listTurns).mockResolvedValue([{ ...second, errorSummary: 'API 请求失败：429 Too Many Requests' }])
    render(<ExecutionTracePanel conversationId="conversation-1" isOpen onClose={vi.fn()} />)

    expect(await screen.findByText('API 请求失败：429 Too Many Requests')).toBeInTheDocument()
    expect(screen.getByText('失败')).toBeInTheDocument()
  })

  it('允许同时展开多个 Turn，点击步骤后才读取原始证据', async () => {
    render(<ExecutionTracePanel conversationId="conversation-1" isOpen onClose={vi.fn()} />)
    await screen.findByText('Turn turn-2')

    fireEvent.click(screen.getByRole('button', { name: /Turn turn-1/ }))
    expect(await screen.findByText('工具调用')).toBeInTheDocument()
    vi.mocked(observabilityApi.getEvidence).mockClear()
    fireEvent.click(screen.getAllByRole('button', { name: '模型请求' })[0])
    expect(observabilityApi.getEvidence).toHaveBeenCalledWith('conversation-1', 'turn-2', 'model-1')
    fireEvent.click(await screen.findByRole('tab', { name: '原始证据' }))
    expect(await screen.findByText(/真实请求/)).toBeInTheDocument()
  })

  it('连续选择步骤时忽略旧证据响应', async () => {
    const modelEvidence = deferred<Awaited<ReturnType<typeof observabilityApi.getEvidence>>>()
    const toolEvidence = deferred<Awaited<ReturnType<typeof observabilityApi.getEvidence>>>()
    vi.mocked(observabilityApi.getEvidence).mockImplementation(async (_conversationId, _turnId, recordId) => {
      return recordId === 'model-1' ? modelEvidence.promise : toolEvidence.promise
    })
    render(<ExecutionTracePanel conversationId="conversation-1" isOpen onClose={vi.fn()} />)
    await screen.findByRole('button', { name: '模型请求' })

    fireEvent.click(screen.getByRole('button', { name: '模型请求' }))
    fireEvent.click(screen.getByRole('button', { name: '工具调用' }))
    fireEvent.click(screen.getByRole('tab', { name: '原始证据' }))
    toolEvidence.resolve(evidence('tool-1', '新证据'))
    expect(await screen.findByText(/新证据/)).toBeInTheDocument()

    modelEvidence.resolve(evidence('model-1', '旧证据'))
    await waitFor(() => expect(screen.queryByText(/旧证据/)).not.toBeInTheDocument())
    expect(screen.getByText(/新证据/)).toBeInTheDocument()
  })

  it('默认时间线读取失败时结束 loading 并展示错误', async () => {
    vi.mocked(observabilityApi.getTurnTimeline).mockRejectedValue(new Error('默认时间线失败'))

    render(<ExecutionTracePanel conversationId="conversation-1" isOpen onClose={vi.fn()} />)

    expect(await screen.findByText('读取时间线失败：默认时间线失败')).toBeInTheDocument()
    expect(screen.queryByText('正在加载时间线…')).not.toBeInTheDocument()
  })

  it('手动展开的时间线读取失败时结束 loading 并展示错误', async () => {
    vi.mocked(observabilityApi.getTurnTimeline).mockImplementation(async (_conversationId, turnId) => {
      if (turnId === 'turn-1')
        throw new Error('手动时间线失败')
      return timeline(turnId)
    })
    render(<ExecutionTracePanel conversationId="conversation-1" isOpen onClose={vi.fn()} />)
    await screen.findByRole('button', { name: '模型请求' })

    fireEvent.click(screen.getByRole('button', { name: /Turn turn-1/ }))

    expect(await screen.findByText('读取时间线失败：手动时间线失败')).toBeInTheDocument()
    expect(screen.queryByText('正在加载时间线…')).not.toBeInTheDocument()
  })

  it('原始证据读取失败时结束 loading 并展示错误', async () => {
    vi.mocked(observabilityApi.getEvidence).mockRejectedValue(new Error('证据失败'))
    render(<ExecutionTracePanel conversationId="conversation-1" isOpen onClose={vi.fn()} />)
    const modelRequest = await screen.findByRole('button', { name: '模型请求' })

    fireEvent.click(modelRequest)

    expect(await screen.findByText('读取原始证据失败：证据失败')).toBeInTheDocument()
    expect(screen.queryByText('正在读取原始证据…')).not.toBeInTheDocument()
  })

  it('实时失效只重查当前会话摘要', async () => {
    render(<ExecutionTracePanel conversationId="conversation-1" isOpen onClose={vi.fn()} />)
    await screen.findByText('Turn turn-2')
    vi.mocked(observabilityApi.listTurns).mockClear()
    vi.mocked(observabilityApi.getTurnTimeline).mockClear()

    eventBoundary.handler?.({ conversationId: 'other', turnId: 'turn-x' })
    eventBoundary.handler?.({ conversationId: 'conversation-1', turnId: 'turn-2' })

    await waitFor(() => expect(observabilityApi.listTurns).toHaveBeenCalledOnce())
    expect(observabilityApi.getTurnTimeline).not.toHaveBeenCalled()
  })

  it('并发摘要重查时忽略旧响应', async () => {
    const older = deferred<AgentTurnSummary[]>()
    const newer = deferred<AgentTurnSummary[]>()
    vi.mocked(observabilityApi.listTurns)
      .mockResolvedValueOnce([first, second])
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise)
    render(<ExecutionTracePanel conversationId="conversation-1" isOpen onClose={vi.fn()} />)
    await screen.findByText('Turn turn-2')

    eventBoundary.handler?.({ conversationId: 'conversation-1', turnId: 'turn-2' })
    eventBoundary.handler?.({ conversationId: 'conversation-1', turnId: 'turn-3' })
    newer.resolve([summary('turn-3', 3_000, 'success'), first, second])
    expect(await screen.findByText('Turn turn-3')).toBeInTheDocument()

    older.resolve([first, second])
    await waitFor(() => expect(screen.getByText('Turn turn-3')).toBeInTheDocument())
  })

  it('同一 Turn 并发时间线查询时忽略旧失败', async () => {
    const older = deferred<AgentTurnTimeline | null>()
    const newer = deferred<AgentTurnTimeline | null>()
    vi.mocked(observabilityApi.getTurnTimeline)
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise)
    render(<ExecutionTracePanel conversationId="conversation-1" isOpen onClose={vi.fn()} />)
    const turn = await screen.findByRole('button', { name: /Turn turn-2/ })

    fireEvent.click(turn)
    fireEvent.click(turn)
    newer.resolve(timeline('turn-2'))
    expect(await screen.findByRole('button', { name: '模型请求' })).toBeInTheDocument()

    older.reject(new Error('旧失败'))
    await waitFor(() => expect(screen.queryByText(/旧失败/)).not.toBeInTheDocument())
  })

  it('从 Turn 入口打开时直接聚焦对应时间线', async () => {
    render(<ExecutionTracePanel conversationId="conversation-1" focusTurnId="turn-1" isOpen onClose={vi.fn()} />)

    await screen.findByText('Turn turn-1')
    await waitFor(() => expect(observabilityApi.getTurnTimeline).toHaveBeenCalledWith('conversation-1', 'turn-1'))
  })

  it('展示不完整、过期和不支持提示', async () => {
    vi.mocked(observabilityApi.listTurns).mockResolvedValue([{ ...first, completeness: 'incomplete', incompleteReasons: ['disk'] }])
    vi.mocked(observabilityApi.getTurnTimeline).mockResolvedValue(null)
    const view = render(<ExecutionTracePanel conversationId="conversation-1" isOpen onClose={vi.fn()} />)
    expect(await screen.findByText('Trace 不完整')).toBeInTheDocument()
    expect(await screen.findByText('Trace 已过期')).toBeInTheDocument()

    vi.mocked(observabilityApi.listTurns).mockRejectedValue(new Error('unsupported schema version'))
    view.rerender(<ExecutionTracePanel conversationId="conversation-2" isOpen onClose={vi.fn()} />)
    expect(await screen.findByText('Trace 版本不受支持')).toBeInTheDocument()
  })

  it('详情展示模型请求的模型、usage、回复与工具调用', async () => {
    vi.mocked(observabilityApi.getEvidence).mockResolvedValue({
      recordId: 'model-1',
      records: [
        modelStarted({
          messages: [{ role: 'user', content: [{ type: 'text', text: '审查代码' }] }],
          modelSettings: { model: 'gpt-4o', systemPrompt: '你是代码助手' },
        }),
        modelCompleted({
          text: '最终回复文本',
          durationMs: 900,
          usage: { inputTokens: 900, outputTokens: 120 },
          finishReason: 'stop',
          toolCalls: [{ id: 'c1', toolName: 'write', input: { path: '/b' } }],
        }),
      ],
    })
    render(<ExecutionTracePanel conversationId="conversation-1" isOpen onClose={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: '模型请求' }))

    expect(await screen.findByText('gpt-4o')).toBeInTheDocument()
    expect(screen.getByText('900')).toBeInTheDocument()
    expect(screen.getByText('120')).toBeInTheDocument()
    expect(screen.getByText('stop')).toBeInTheDocument()
    expect(screen.getByText('最终回复文本')).toBeInTheDocument()
    expect(screen.getByText('write')).toBeInTheDocument()
  })

  it('工具调用失败时详情展示失败状态与错误原因', async () => {
    vi.mocked(observabilityApi.getEvidence).mockResolvedValue({
      recordId: 'tool-1',
      records: [
        toolStarted({ toolCallId: 'c1', toolName: 'write', input: { path: '/a' } }),
        toolCompleted('failed', undefined, { status: 'failed', error: '磁盘已满', exitCode: 1, durationMs: 30 }),
      ],
    })
    render(<ExecutionTracePanel conversationId="conversation-1" isOpen onClose={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: '工具调用' }))

    expect(await screen.findByText('磁盘已满')).toBeInTheDocument()
    expect(screen.getByText('write')).toBeInTheDocument()
    const drawer = screen.getByLabelText('步骤证据')
    expect(within(drawer).getByText('失败')).toBeInTheDocument()
  })

  it('记忆授权放行时同时展示基础判定与最终依据', async () => {
    vi.mocked(observabilityApi.getTurnTimeline).mockResolvedValue({
      summary: first,
      items: [{ type: 'span', recordId: 'policy-1', spanId: 'span-9', kind: 'policy-decision', status: 'allow', startedAt: first.startedAt, endedAt: first.startedAt + 5, durationMs: 5 }],
    })
    vi.mocked(observabilityApi.getEvidence).mockResolvedValue({
      recordId: 'policy-1',
      records: [
        {
          schemaVersion: 1,
          sequence: 1,
          recordedAt: 2_000,
          traceId: 'trace-turn-2',
          recordId: 'policy-1',
          recordType: 'span-started',
          spanId: 'span-9',
          spanKind: 'policy-decision',
          startedAt: 2_000,
          input: { toolName: 'write', input: { path: '/workspace/a.txt' }, operationType: 'write', scope: 'workspace', policy: 'require_approval', basis: 'default.require-approval', initialDecision: { outcome: 'require_approval', basis: 'default.require-approval' }, mode: 'strict' },
        },
        {
          schemaVersion: 1,
          sequence: 2,
          recordedAt: 2_005,
          traceId: 'trace-turn-2',
          recordId: 'policy-2',
          recordType: 'span-completed',
          spanId: 'span-9',
          spanKind: 'policy-decision',
          status: 'allow',
          endedAt: 2_005,
          output: {
            status: 'allow',
            outcome: 'allow',
            effectiveDecision: { outcome: 'allow', basis: 'approval-grant.match' },
            permissionRules: [{ ruleId: 'rule-a', kind: 'filesystem', effect: 'allow', group: 'workspace' }],
          },
        },
      ],
    })
    render(<ExecutionTracePanel conversationId="conversation-1" isOpen onClose={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: '策略判断' }))

    expect(await screen.findByText('默认权限')).toBeInTheDocument()
    expect(screen.getByText('当前权限模式要求人工审批')).toBeInTheDocument()
    expect(screen.getByText('已命中用户记住的授权规则')).toBeInTheDocument()
    expect(screen.getByText('rule-a')).toBeInTheDocument()
  })

  it('开发者视图展示请求参数与模型响应', async () => {
    vi.mocked(observabilityApi.getEvidence).mockResolvedValue({
      recordId: 'model-1',
      records: [
        modelStarted({
          messages: [{ role: 'user', content: [{ type: 'text', text: '审查代码' }] }],
          modelSettings: { model: 'gpt-4o', systemPrompt: '你是代码助手' },
          tools: [{ name: 'read', serverName: 'native', description: '读取文件', inputSchema: { type: 'object', properties: {}, required: [] } }],
        }),
        modelCompleted({ text: '回复', durationMs: 10 }),
      ],
    })
    render(<ExecutionTracePanel conversationId="conversation-1" isOpen onClose={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: '模型请求' }))

    fireEvent.click(await screen.findByRole('tab', { name: '详情' }))

    expect(await screen.findByText('gpt-4o')).toBeInTheDocument()
    expect(screen.getByText('回复文本')).toBeInTheDocument()
    expect(screen.getByText('响应耗时')).toBeInTheDocument()
  })

  it('原始证据支持复制单条记录', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<ExecutionTracePanel conversationId="conversation-1" isOpen onClose={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: '模型请求' }))
    fireEvent.click(await screen.findByRole('tab', { name: '原始证据' }))

    fireEvent.click(await screen.findByRole('button', { name: '复制该记录' }))

    await waitFor(() => expect(writeText).toHaveBeenCalledOnce())
    expect(writeText.mock.calls[0][0]).toContain('model-1')
  })

  it('窄屏使用全屏 Sheet 展示', async () => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList)

    render(<ExecutionTracePanel conversationId="conversation-1" isOpen onClose={vi.fn()} />)

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: '执行轨迹' })).not.toBeInTheDocument()
  })
})

function summary(turnId: string, startedAt: number, status: 'success' | 'failed'): CompletedAgentTurnSummary {
  return {
    conversationId: 'conversation-1',
    turnId,
    availability: 'available',
    lifecycle: 'completed',
    traceId: `trace-${turnId}`,
    source: { type: 'interactive' },
    status,
    completeness: 'complete',
    incompleteReasons: [],
    startedAt,
    endedAt: startedAt + 500,
    durationMs: 500,
    spanCounts: { modelRequests: 1, policyDecisions: 0, toolCalls: 1, contextEvents: 0 },
  }
}

function collectingSummary(turnId: string, startedAt: number): CollectingAgentTurnSummary {
  return {
    conversationId: 'conversation-1',
    turnId,
    availability: 'available',
    lifecycle: 'collecting',
    traceId: `trace-${turnId}`,
    source: { type: 'interactive' },
    startedAt,
    spanCounts: { modelRequests: 1, policyDecisions: 0, toolCalls: 0, contextEvents: 0 },
  }
}

function timeline(turnId: string): AgentTurnTimeline {
  const target = turnId === 'turn-2' ? first : second
  return {
    summary: target,
    items: [
      { type: 'span', recordId: 'model-1', spanId: 'span-1', kind: 'model-request', status: 'success', startedAt: target.startedAt, endedAt: target.startedAt + 200, durationMs: 200 },
      { type: 'span', recordId: 'tool-1', spanId: 'span-2', kind: 'tool-call', status: 'success', startedAt: target.startedAt + 220, endedAt: target.startedAt + 400, durationMs: 180 },
    ],
  }
}

function evidence(recordId: string, content: string): Awaited<ReturnType<typeof observabilityApi.getEvidence>> {
  return {
    recordId,
    records: [{
      schemaVersion: 1,
      sequence: 1,
      recordedAt: 2_000,
      traceId: 'trace-turn-2',
      recordId,
      recordType: 'span-started',
      spanId: `span-${recordId}`,
      spanKind: 'model-request',
      startedAt: 2_000,
      input: { content },
    }],
  }
}

function modelStarted(input: unknown): import('@ant-chat/shared').AgentObservabilityRecord {
  return {
    schemaVersion: 1,
    sequence: 1,
    recordedAt: 2_000,
    traceId: 'trace-turn-2',
    recordId: 'model-1',
    recordType: 'span-started',
    spanId: 'span-1',
    spanKind: 'model-request',
    startedAt: 2_000,
    input,
  }
}

function modelCompleted(output: unknown): import('@ant-chat/shared').AgentObservabilityRecord {
  return {
    schemaVersion: 1,
    sequence: 2,
    recordedAt: 2_900,
    traceId: 'trace-turn-2',
    recordId: 'model-2',
    recordType: 'span-completed',
    spanId: 'span-1',
    spanKind: 'model-request',
    status: 'success',
    endedAt: 2_900,
    output,
  }
}

function toolStarted(input: unknown): import('@ant-chat/shared').AgentObservabilityRecord {
  return {
    schemaVersion: 1,
    sequence: 1,
    recordedAt: 2_200,
    traceId: 'trace-turn-2',
    recordId: 'tool-1',
    recordType: 'span-started',
    spanId: 'span-2',
    spanKind: 'tool-call',
    startedAt: 2_200,
    input,
  }
}

function toolCompleted(status: 'success' | 'failed', output?: unknown, error?: unknown): import('@ant-chat/shared').AgentObservabilityRecord {
  return {
    schemaVersion: 1,
    sequence: 2,
    recordedAt: 2_400,
    traceId: 'trace-turn-2',
    recordId: 'tool-2',
    recordType: 'span-completed',
    spanId: 'span-2',
    spanKind: 'tool-call',
    status,
    endedAt: 2_400,
    output,
    error,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}
