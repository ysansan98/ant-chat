import type { HookAggregateResult, HookEvent, IHookDispatcher } from '@ant-chat/shared'
import { describe, expect, it, vi } from 'vitest'
import { runCompact } from '../compactCommand'

const conversation = {
  id: 'c1',
  title: '会话',
  workspacePath: '/workspace',
  createdAt: 1,
  updatedAt: 1,
  settings: { providerId: 'p1', modelId: 'm1' },
}

const messages = [
  { id: 'm1', convId: 'c1', createdAt: 1, role: 'user' as const, status: 'success' as const, content: [{ type: 'text' as const, text: 'hello' }] },
  { id: 'm2', convId: 'c1', createdAt: 2, role: 'assistant' as const, status: 'success' as const, content: [{ type: 'text' as const, text: 'world' }] },
]

function createDeps() {
  return {
    appDataContext: {
      conversationRepository: { getById: vi.fn(async () => conversation) },
      messageRepository: { listByConversation: vi.fn(async () => messages) },
      modelCatalog: { resolveModel: vi.fn(async () => null) },
    },
    eventEmitter: { emitMessageUpdated: vi.fn(), emitTaskUpdated: vi.fn(), emitApprovalRequired: vi.fn(), emitTurnStarted: vi.fn(), emitTurnChunk: vi.fn(), emitTurnToolCalls: vi.fn(), emitTurnFinished: vi.fn() },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  }
}

describe('manual compact PreCompact hook', () => {
  it('preCompact deny 阻止手动压缩，并触发 PostCompact(blocked)', async () => {
    const run = vi.fn(async (event: HookEvent): Promise<HookAggregateResult> => event === 'PreCompact'
      ? { event, executions: [], decision: 'deny', reason: '现在不要压缩' }
      : { event, executions: [] })
    const deps = createDeps()
    const result = await runCompact({
      appDataContext: deps.appDataContext as never,
      eventEmitter: deps.eventEmitter,
      conversationId: 'c1',
      instruction: undefined,
      modelConfig: { modelId: 'm1' },
      logger: deps.logger,
      hooks: { run } as IHookDispatcher,
    })

    expect(result.summaryText).toContain('hook 阻止')
    expect(result.summaryText).toContain('现在不要压缩')
    expect(run).toHaveBeenCalledWith('PreCompact', expect.objectContaining({ trigger: 'manual' }), expect.anything())
    expect(run).toHaveBeenCalledWith('PostCompact', expect.objectContaining({ status: 'blocked' }), expect.anything())
    // 未进入压缩事务：不解析模型。
    expect(deps.appDataContext.modelCatalog.resolveModel).not.toHaveBeenCalled()
  })

  it('preCompact continue:false 同样阻止压缩', async () => {
    const run = vi.fn(async (event: HookEvent): Promise<HookAggregateResult> => ({ event, executions: [], ...(event === 'PreCompact' ? { continue: false } : {}) }))
    const deps = createDeps()
    const result = await runCompact({
      appDataContext: deps.appDataContext as never,
      eventEmitter: deps.eventEmitter,
      conversationId: 'c1',
      instruction: undefined,
      modelConfig: { modelId: 'm1' },
      logger: deps.logger,
      hooks: { run } as IHookDispatcher,
    })
    expect(result.summaryText).toContain('hook 阻止')
  })

  it('未注入 hooks 时继续走原压缩路径', async () => {
    const deps = createDeps()
    const result = await runCompact({
      appDataContext: deps.appDataContext as never,
      eventEmitter: deps.eventEmitter,
      conversationId: 'c1',
      instruction: undefined,
      modelConfig: { modelId: 'm1' },
      logger: deps.logger,
    })
    // 事务因模型解析失败返回 error，证明已进入压缩路径（未被 hook 拦截）。
    expect(result.summaryText).not.toContain('hook 阻止')
  })
})
