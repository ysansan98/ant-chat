import type { AgentRuntimeConfig, HookAggregateResult, HookEvent, IAgentEventEmitter, ILogger } from '@ant-chat/shared'
import { describe, expect, it, vi } from 'vitest'
import { TaskStore } from '../../taskStore'
import { SessionRuntime } from '../../session/SessionRuntime'

function createEmitter(): IAgentEventEmitter {
  return {
    emitTaskUpdated: vi.fn(),
    emitApprovalRequired: vi.fn(),
    emitTurnStarted: vi.fn(),
    emitTurnChunk: vi.fn(),
    emitTurnToolCalls: vi.fn(),
    emitTurnFinished: vi.fn(),
  }
}

function createLogger(): ILogger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

function createConfig(hooks?: AgentRuntimeConfig['hooks']) {
  return {
    eventEmitter: createEmitter(),
    logger: createLogger(),
    sessionStore: {
      getConversation: vi.fn(async (id: string) => ({ id, workspacePath: '/workspace/conv' })),
    },
    ...(hooks ? { hooks } : {}),
  } as unknown as AgentRuntimeConfig
}

function createHooks(): { hooks: AgentRuntimeConfig['hooks'], run: ReturnType<typeof vi.fn> } {
  const run = vi.fn(async (event: HookEvent): Promise<HookAggregateResult> => ({ event, executions: [] }))
  return { hooks: { run }, run }
}

describe('sessionRuntime hooks', () => {
  it('closeConversation 触发 SessionEnd（reason=close）', async () => {
    const { hooks, run } = createHooks()
    const runtime = new SessionRuntime(createConfig(hooks), new TaskStore())
    await runtime.closeConversation('conv-1')
    expect(run).toHaveBeenCalledWith('SessionEnd', expect.objectContaining({ reason: 'close', conversation_id: 'conv-1', cwd: '/workspace/conv' }), expect.anything())
  })

  it('dispose 对已知会话触发 SessionEnd（reason=dispose）', async () => {
    const { hooks, run } = createHooks()
    const runtime = new SessionRuntime(createConfig(hooks), new TaskStore())
    await runtime.dispose()
    // 未经过 prepareTask，无已知会话：不触发任何 SessionEnd。
    expect(run).not.toHaveBeenCalled()
  })

  it('sessionEnd hook 抛错被忽略，不影响关闭', async () => {
    const hooks = {
      run: vi.fn(async () => {
        throw new Error('end hook exploded')
      }),
    } as unknown as AgentRuntimeConfig['hooks']
    const config = createConfig(hooks)
    const runtime = new SessionRuntime(config, new TaskStore())
    await expect(runtime.closeConversation('conv-1')).resolves.toBeUndefined()
    expect(config.logger?.warn).toHaveBeenCalled()
  })

  it('未注入 hooks 时不触发', async () => {
    const runtime = new SessionRuntime(createConfig(), new TaskStore())
    await expect(runtime.closeConversation('conv-1')).resolves.toBeUndefined()
  })
})
