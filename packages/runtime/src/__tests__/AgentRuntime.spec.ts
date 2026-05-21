import { describe, expect, it, vi } from 'vitest'
import { AgentRuntime } from '../AgentRuntime'
import { taskStore } from '../loop/taskStore'
import type { AgentRuntimeConfig, IAgentEventEmitter, ILogger } from '@ant-chat/shared'
import type { RuntimeStartInput } from '../session/types'

// Mock the agentLoop so startTask doesn't actually run the loop
vi.mock('../loop/agentLoop', () => ({
  runAgentLoop: vi.fn().mockResolvedValue(undefined),
}))

function createMockEmitter(): IAgentEventEmitter {
  return {
    emitTaskUpdated: vi.fn(),
    emitApprovalRequired: vi.fn(),
    emitTurnStarted: vi.fn(),
    emitTurnChunk: vi.fn(),
    emitTurnToolCalls: vi.fn(),
    emitTurnFinished: vi.fn(),
    emitCompactionSaved: vi.fn(),
  }
}

function createMockLogger(): ILogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
}

function createConfig(): AgentRuntimeConfig {
  return {
    eventEmitter: createMockEmitter(),
    logger: createMockLogger(),
  }
}

function createValidStartInput(overrides: Partial<RuntimeStartInput> = {}): RuntimeStartInput {
  return {
    conversationId: 'conv-1',
    userMessageId: 'msg-1',
    workspacePath: '/workspace',
    mode: 'hybrid',
    prompt: 'test prompt',
    messages: [],
    systemPrompt: 'You are helpful.',
    tools: [],
    aiProvider: null,
    modelName: 'test-model',
    providerName: 'test-provider',
    providerId: 'provider-1',
    apiMode: 'openai',
    ...overrides,
  }
}

// Clean up taskStore between tests
function cleanupTasks(ids: string[]) {
  for (const id of ids) {
    try {
      taskStore.finish(id)
    }
    catch {}
    try {
      taskStore.delete(id)
    }
    catch {}
  }
}

describe('agentRuntime', () => {
  describe('startTask', () => {
    it('returns taskId and creates task in store', async () => {
      const config = createConfig()
      const runtime = new AgentRuntime(config)
      const input = createValidStartInput()

      const result = await runtime.startTask(input)

      expect(result.taskId).toBeDefined()
      expect(typeof result.taskId).toBe('string')
      expect(result.taskId.length).toBeGreaterThan(0)

      const task = taskStore.get(result.taskId)
      expect(task).toBeDefined()
      expect(task?.snapshot.status).toBe('running')
      expect(task?.snapshot.conversationId).toBe('conv-1')
      expect(task?.snapshot.prompt).toBe('test prompt')

      cleanupTasks([result.taskId])
    })

    it('validates missing conversationId', async () => {
      const runtime = new AgentRuntime(createConfig())
      await expect(
        runtime.startTask(createValidStartInput({ conversationId: '' })),
      ).rejects.toThrow('missing conversationId')
    })

    it('validates missing userMessageId', async () => {
      const runtime = new AgentRuntime(createConfig())
      await expect(
        runtime.startTask(createValidStartInput({ userMessageId: '' })),
      ).rejects.toThrow('missing userMessageId')
    })

    it('validates missing prompt', async () => {
      const runtime = new AgentRuntime(createConfig())
      await expect(
        runtime.startTask(createValidStartInput({ prompt: '' })),
      ).rejects.toThrow('missing prompt')
    })

    it('validates multiple missing fields at once', async () => {
      const runtime = new AgentRuntime(createConfig())
      await expect(
        runtime.startTask(createValidStartInput({ conversationId: '', userMessageId: '' })),
      ).rejects.toThrow('missing conversationId, userMessageId')
    })

    it('emits taskUpdated event on start', async () => {
      const emitter = createMockEmitter()
      const config: AgentRuntimeConfig = { eventEmitter: emitter, logger: createMockLogger() }
      const runtime = new AgentRuntime(config)

      const result = await runtime.startTask(createValidStartInput())
      expect(emitter.emitTaskUpdated).toHaveBeenCalledTimes(1)
      expect(emitter.emitTaskUpdated).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: result.taskId,
          status: 'running',
          conversationId: 'conv-1',
        }),
      )

      cleanupTasks([result.taskId])
    })

    it('prevents duplicate tasks for same conversation', async () => {
      const runtime = new AgentRuntime(createConfig())
      const result1 = await runtime.startTask(createValidStartInput())

      await expect(
        runtime.startTask(createValidStartInput()),
      ).rejects.toThrow('AGENT_TASK_ALREADY_RUNNING')

      cleanupTasks([result1.taskId])
    })
  })

  describe('getTask', () => {
    it('returns task snapshot for existing task', async () => {
      const runtime = new AgentRuntime(createConfig())
      const result = await runtime.startTask(createValidStartInput())
      const snapshot = runtime.getTask(result.taskId)
      expect(snapshot.taskId).toBe(result.taskId)
      expect(snapshot.status).toBe('running')
      cleanupTasks([result.taskId])
    })

    it('throws for non-existent taskId', () => {
      const runtime = new AgentRuntime(createConfig())
      expect(() => runtime.getTask('nonexistent')).toThrow('Task not found')
    })
  })

  describe('listActiveTasks', () => {
    it('lists active tasks for a conversation', async () => {
      const runtime = new AgentRuntime(createConfig())
      const result = await runtime.startTask(
        createValidStartInput({ conversationId: 'conv-list' }),
      )

      const tasks = runtime.listActiveTasks('conv-list')
      expect(tasks).toHaveLength(1)
      expect(tasks[0].taskId).toBe(result.taskId)

      cleanupTasks([result.taskId])
      expect(runtime.listActiveTasks('conv-list')).toHaveLength(0)
    })

    it('lists all active tasks when no conversationId', async () => {
      const config = createConfig()
      const runtime = new AgentRuntime(config)
      const r1 = await runtime.startTask(
        createValidStartInput({ conversationId: 'conv-a' }),
      )
      const r2 = await runtime.startTask(
        createValidStartInput({ conversationId: 'conv-b' }),
      )

      const all = runtime.listActiveTasks()
      expect(all).toHaveLength(2)

      cleanupTasks([r1.taskId, r2.taskId])
    })
  })

  describe('approvePendingAction', () => {
    it('delegates to approvalController.approvePendingAction', () => {
      const runtime = new AgentRuntime(createConfig())

      // This should throw because there's no task awaiting approval
      expect(() =>
        runtime.approvePendingAction({ taskId: 'nonexistent', actionId: 'action-1' }),
      ).toThrow('Task not found')
    })
  })

  describe('rejectPendingAction', () => {
    it('delegates to approvalController.rejectPendingAction', () => {
      const runtime = new AgentRuntime(createConfig())
      expect(() =>
        runtime.rejectPendingAction({ taskId: 'nonexistent', actionId: 'action-1' }),
      ).toThrow('Task not found')
    })
  })

  describe('cancelTask', () => {
    it('delegates to approvalController.cancelTask', () => {
      const runtime = new AgentRuntime(createConfig())
      expect(() => runtime.cancelTask({ taskId: 'nonexistent' })).toThrow('Task not found')
    })

    it('cancels a running task', async () => {
      const runtime = new AgentRuntime(createConfig())
      const result = await runtime.startTask(createValidStartInput())
      runtime.cancelTask({ taskId: result.taskId })
      const task = taskStore.get(result.taskId)
      expect(task?.snapshot.status).toBe('cancelled')
      cleanupTasks([result.taskId])
    })
  })
})
