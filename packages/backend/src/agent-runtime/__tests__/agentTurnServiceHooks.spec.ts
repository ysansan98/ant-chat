import type { AgentRuntime } from '../../agent-core'
import type { AppDataContext } from '../../data'
import type { PendingMessageService } from '../pendingMessageService'
import type { HookAggregateResult, HookEvent, IHookDispatcher } from '@ant-chat/shared'
import { describe, expect, it, vi } from 'vitest'
import { createAgentTurnService } from '../agentTurnService'

const model = { id: 'model-1', model: 'mock-model', name: 'Mock Model', providerId: 'provider-1', contextLength: 128_000 }
const provider = { id: 'provider-1', name: 'Provider', apiMode: 'openai' as const, apiKey: 'k', baseUrl: 'https://example.com', isOfficial: false, isEnabled: true, createdAt: 1, updatedAt: 1 }
const conversation = {
  id: 'c1',
  title: '已有会话',
  workspacePath: '/workspace',
  createdAt: 1,
  updatedAt: 1,
  conversationInstructions: '',
  settings: { modelId: 'model-1', providerId: 'provider-1' },
}

function createDeps(hooks?: IHookDispatcher) {
  const startSessionTask = vi.fn(async () => ({ taskId: 't1', conversationId: 'c1', userMessageId: 'm1' }))
  const runtime = {
    startSessionTask,
    listActiveTasks: vi.fn(() => [] as Array<{ taskId: string }>),
  } as unknown as AgentRuntime
  const appDataContext = {
    modelCatalog: { resolveModel: vi.fn(async () => ({ model, provider })) },
    messageRepository: {
      create: vi.fn(async () => ({ id: 'm1', convId: 'c1', createdAt: 2, role: 'user', status: 'success', content: [{ type: 'text', text: 'hello' }] })),
      getById: vi.fn(async () => ({ id: 'm1', convId: 'c1', createdAt: 2, role: 'user', status: 'success', content: [{ type: 'text', text: 'hello' }] })),
    },
    settingsRepository: { getGeneralSettings: vi.fn(async () => ({ autoGenerateTitle: false })) },
  } as unknown as AppDataContext
  const conversationLifecycle = {
    get: vi.fn(async () => conversation),
    update: vi.fn(),
  }
  const pendingMessages = {
    enqueue: vi.fn(),
    listRecords: vi.fn(async () => []),
    remove: vi.fn(),
  } as unknown as PendingMessageService
  const service = createAgentTurnService({
    runtime,
    appDataContext,
    conversationLifecycle: conversationLifecycle as never,
    pendingMessages,
    hooks,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  })
  return { service, startSessionTask, runtime }
}

function createHooks(result: Partial<HookAggregateResult>): { hooks: IHookDispatcher, run: ReturnType<typeof vi.fn> } {
  const run = vi.fn(async (event: HookEvent): Promise<HookAggregateResult> => ({ event, executions: [], ...result }))
  return { hooks: { run }, run }
}

const baseOptions = {
  conversationId: 'c1',
  messageContent: [{ type: 'text' as const, text: 'hello' }],
  workspacePath: '/workspace',
  modelConfig: { modelId: 'model-1', providerId: 'provider-1' },
}

describe('userPromptSubmit hook', () => {
  it('hook deny 时不启动 turn，返回 blocked 与原因', async () => {
    const { hooks, run } = createHooks({ decision: 'deny', reason: '提示包含密钥' })
    const { service, startSessionTask } = createDeps(hooks)
    const result = await service.startTurn(baseOptions)
    expect(result).toEqual({ kind: 'blocked', reason: '提示包含密钥', conversationId: 'c1' })
    expect(startSessionTask).not.toHaveBeenCalled()
    expect(run).toHaveBeenCalledWith('UserPromptSubmit', expect.objectContaining({ prompt: 'hello', conversation_id: 'c1' }), expect.anything())
  })

  it('hook additionalContext 透传到 runtime 且不持久化为用户消息', async () => {
    const { hooks } = createHooks({ additionalContext: '公司规范：先读文档' })
    const { service, startSessionTask } = createDeps(hooks)
    const result = await service.startTurn(baseOptions)
    expect(result.kind).toBe('started')
    expect(startSessionTask).toHaveBeenCalledWith(expect.objectContaining({ hookAdditionalContext: '公司规范：先读文档' }))
  })

  it('hook 抛错时按无决策继续启动 turn', async () => {
    const hooks = {
      run: vi.fn(async () => {
        throw new Error('boom')
      }),
    } as unknown as IHookDispatcher
    const { service, startSessionTask } = createDeps(hooks)
    const result = await service.startTurn(baseOptions)
    expect(result.kind).toBe('started')
    expect(startSessionTask).toHaveBeenCalled()
  })

  it('未注入 hooks 时行为与现状一致', async () => {
    const { service, startSessionTask } = createDeps()
    const result = await service.startTurn(baseOptions)
    expect(result.kind).toBe('started')
    expect(startSessionTask).toHaveBeenCalledWith(expect.objectContaining({ hookAdditionalContext: undefined }))
  })
})
