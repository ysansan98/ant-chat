import { describe, expect, it, vi } from 'vitest'
import { AgentRuntime } from '../AgentRuntime'
import { runAgentLoop } from '../loop/agentLoop'
import { taskStore } from '../taskStore'
import { ToolRegistry } from '../tools/toolRegistry'
import type { AgentRuntimeConfig, IAgentEventEmitter, ILogger, ISessionStore } from '@ant-chat/shared'
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
    emitMessageUpdated: vi.fn(),
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

function createSessionStore(overrides: Partial<ISessionStore> = {}): ISessionStore {
  const conversation = {
    id: 'conv-session',
    title: 'Untitled',
    workspacePath: '/workspace',
    createdAt: 1,
    updatedAt: 1,
    settings: {
      modelId: 'model-1',
      systemPrompt: '',
      temperature: 0.7,
      maxTokens: 1024,
    },
  }
  return {
    getConversation: vi.fn(async () => conversation),
    getConversationById: vi.fn(async () => conversation),
    createConversation: vi.fn(async () => conversation),
    updateConversation: vi.fn(async () => conversation),
    listConversations: vi.fn(async () => [conversation]),
    getMessages: vi.fn(async () => []),
    getMessagesByConvId: vi.fn(async () => []),
    createUserMessage: vi.fn(async () => ({
      id: 'user-msg-1',
      convId: conversation.id,
      createdAt: 2,
      role: 'user' as const,
      status: 'success' as const,
      content: [{ type: 'text' as const, text: 'inspect project' }],
      images: [],
      attachments: [],
    })),
    createAssistantMessage: vi.fn(async () => ({
      id: 'assistant-msg-1',
      convId: conversation.id,
      createdAt: 3,
      role: 'assistant' as const,
      status: 'loading' as const,
      content: [],
      modelInfo: { provider: 'provider', providerId: 'provider-1', model: 'test-model' },
    })),
    updateAssistantMessage: vi.fn(async () => ({
      id: 'assistant-msg-1',
      convId: conversation.id,
      createdAt: 3,
      role: 'assistant' as const,
      status: 'success' as const,
      content: [],
      modelInfo: { provider: 'provider', providerId: 'provider-1', model: 'test-model' },
    })),
    createToolMessage: vi.fn(async data => ({
      id: 'tool-msg-1',
      convId: data.convId,
      createdAt: Date.now(),
      role: 'tool' as const,
      status: data.status,
      content: data.content,
    })),
    createEventMessage: vi.fn(async data => ({
      id: 'event-msg-1',
      convId: data.convId,
      createdAt: Date.now(),
      role: 'event' as const,
      status: data.status,
      content: data.content,
      eventType: data.eventType,
    })),
    updateEventMessage: vi.fn(async (id, patch) => ({
      id,
      convId: conversation.id,
      createdAt: Date.now(),
      role: 'event' as const,
      status: patch.status ?? 'loading',
      content: patch.content ?? [],
      eventType: patch.eventType ?? 'compaction',
      modelInfo: patch.modelInfo ?? undefined,
      usage: patch.usage ?? undefined,
      compactedThroughMessageId: patch.compactedThroughMessageId ?? undefined,
    })),
    ...overrides,
  }
}

function createSessionConfig(overrides: Partial<AgentRuntimeConfig> = {}): AgentRuntimeConfig {
  return {
    ...createConfig(),
    sessionStore: createSessionStore(),
    modelCatalog: {
      getModelById: vi.fn(async () => ({
        id: 'model-1',
        model: 'test-model',
        name: 'Test Model',
        providerId: 'provider-1',
        contextLength: 128_000,
      })),
      getProviderById: vi.fn(async () => ({
        id: 'provider-1',
        name: 'provider',
        apiMode: 'openai' as const,
        apiKey: 'test-key',
        baseUrl: 'https://example.com',
        isOfficial: false,
        isEnabled: true,
        createdAt: 1,
        updatedAt: 1,
      })),
    },
    aiProviderFactory: vi.fn(async () => ({
      streamModel: vi.fn(),
      complete: vi.fn(),
    })),
    compactionStrategy: { summarize: vi.fn() },
    ...overrides,
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
    registry: new ToolRegistry([]),
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

    it('creates session state and starts loop from high-level task options', async () => {
      const store = createSessionStore()
      const config = createSessionConfig({ sessionStore: store })
      const runtime = new AgentRuntime(config)

      const result = await runtime.startTask({
        prompt: ' inspect project ',
        modelId: 'model-1',
        workspacePath: '/workspace',
        mode: 'hybrid',
        modelSettings: {
          systemPrompt: '',
          temperature: 0.7,
          maxTokens: 1024,
        },
      })

      expect(store.createConversation).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Untitled',
        workspacePath: '/workspace',
      }))
      expect(store.createUserMessage).toHaveBeenCalledWith(expect.objectContaining({
        convId: 'conv-session',
        role: 'user',
        content: [{ type: 'text', text: 'inspect project' }],
      }))
      expect(result).toEqual(expect.objectContaining({
        conversationId: 'conv-session',
        userMessageId: 'user-msg-1',
      }))

      cleanupTasks([result.taskId])
    })

    it('uses a conversation-level USER.md and MEMORY.md snapshot in the loop system prompt', async () => {
      const store = createSessionStore()
      let userMarkdown = '§Prefer concise Chinese.'
      let memoryMarkdown = '§Use pnpm check.'
      const config = createSessionConfig({
        sessionStore: store,
        memoryReader: {
          readUserMemory: vi.fn(async () => userMarkdown),
          readMemory: vi.fn(async () => memoryMarkdown),
          readSoul: vi.fn(async () => '# SOUL\n\n- Verify before reporting.'),
          editMemory: vi.fn(),
          updateSoul: vi.fn(),
        },
      })
      const runtime = new AgentRuntime(config)

      const result = await runtime.startTask({
        prompt: 'inspect project',
        modelId: 'model-1',
        workspacePath: '/workspace',
        mode: 'hybrid',
      })

      expect(runAgentLoop).toHaveBeenCalledWith(expect.objectContaining({
        options: expect.objectContaining({
          systemPrompt: expect.stringContaining('<agent_behavior>'),
        }),
      }))
      expect(runAgentLoop).toHaveBeenCalledWith(expect.objectContaining({
        options: expect.objectContaining({
          systemPrompt: expect.stringContaining('Prefer concise Chinese.'),
        }),
      }))
      expect(runAgentLoop).toHaveBeenCalledWith(expect.objectContaining({
        options: expect.objectContaining({
          systemPrompt: expect.stringContaining('<memory_guidance>'),
        }),
      }))
      expect(runAgentLoop).toHaveBeenCalledWith(expect.objectContaining({
        options: expect.objectContaining({
          systemPrompt: expect.stringContaining('Use pnpm check.'),
        }),
      }))
      expect(runAgentLoop).toHaveBeenCalledWith(expect.objectContaining({
        options: expect.objectContaining({
          systemPrompt: expect.not.stringContaining('visible in later tasks'),
        }),
      }))
      const calls = vi.mocked(runAgentLoop).mock.calls
      const lastCall = calls[calls.length - 1]
      const registry = lastCall?.[0].options.registry
      expect(registry?.listTools()).toEqual(expect.arrayContaining([
        expect.objectContaining({
          name: 'memory',
          description: expect.stringContaining('target="user"'),
        }),
      ]))
      expect(registry?.listTools()).toEqual(expect.arrayContaining([
        expect.objectContaining({
          name: 'memory',
          description: expect.stringContaining('declarative facts'),
        }),
      ]))
      expect(runAgentLoop).toHaveBeenCalledWith(expect.objectContaining({
        options: expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'user',
              content: [{ type: 'text', text: 'inspect project' }],
            }),
          ]),
        }),
      }))

      cleanupTasks([result.taskId])

      userMarkdown = '§Prefer verbose English.'
      memoryMarkdown = '§Use npm test.'
      const secondResult = await runtime.startTask({
        conversationId: 'conv-session',
        prompt: 'inspect project again',
        modelId: 'model-1',
        workspacePath: '/workspace',
        mode: 'hybrid',
      })

      const secondCalls = vi.mocked(runAgentLoop).mock.calls
      const secondCall = secondCalls[secondCalls.length - 1]
      expect(secondCall?.[0].options.systemPrompt).toContain('Prefer concise Chinese.')
      expect(secondCall?.[0].options.systemPrompt).toContain('Use pnpm check.')
      expect(secondCall?.[0].options.systemPrompt).not.toContain('Prefer verbose English.')
      expect(secondCall?.[0].options.systemPrompt).not.toContain('Use npm test.')
      cleanupTasks([secondResult.taskId])
    })

    it('compacts persisted history before writing the new user message and refreshes memory', async () => {
      const conversation = {
        id: 'conv-session',
        title: 'Untitled',
        workspacePath: '/workspace',
        createdAt: 1,
        updatedAt: 1,
        settings: {
          modelId: 'model-1',
          systemPrompt: '',
          temperature: 0.7,
          maxTokens: 1024,
          compaction: { enabled: true, thresholdPercent: 70, keepRecentTokens: 16 },
        },
      }
      let historyMessages: Awaited<ReturnType<ISessionStore['getMessages']>> = []
      const store = createSessionStore({
        getConversation: vi.fn(async () => conversation),
        getConversationById: vi.fn(async () => conversation),
        createConversation: vi.fn(async () => conversation),
        getMessages: vi.fn(async () => historyMessages),
      })
      let memoryMarkdown = '§Initial memory.'
      const readMemory = vi.fn(async () => memoryMarkdown)
      const readUserMemory = vi.fn(async () => '§Prefer concise Chinese.')
      const config = createSessionConfig({
        sessionStore: store,
        modelCatalog: {
          getModelById: vi.fn(async () => ({
            id: 'model-1',
            model: 'test-model',
            name: 'Test Model',
            providerId: 'provider-1',
            contextLength: 20_000,
          })),
          getProviderById: vi.fn(async () => ({
            id: 'provider-1',
            name: 'provider',
            apiMode: 'openai' as const,
            apiKey: 'test-key',
            baseUrl: 'https://example.com',
            isOfficial: false,
            isEnabled: true,
            createdAt: 1,
            updatedAt: 1,
          })),
        },
        compactionStrategy: {
          summarize: vi.fn(async () => ({
            text: 'Earlier context summary.',
            usage: { inputTokens: 12000, outputTokens: 300, totalTokens: 12300 },
          })),
        },
        memoryReader: {
          readUserMemory,
          readMemory,
          readSoul: vi.fn(async () => '# SOUL\n\n- Verify before reporting.'),
          editMemory: vi.fn(),
          updateSoul: vi.fn(),
        },
      })
      const runtime = new AgentRuntime(config)

      const firstResult = await runtime.startTask({
        conversationId: 'conv-session',
        prompt: 'inspect project first',
        modelId: 'model-1',
        workspacePath: '/workspace',
        mode: 'hybrid',
      })
      cleanupTasks([firstResult.taskId])

      memoryMarkdown = '§Updated memory after compaction.'
      historyMessages = [
        { id: 'u1', convId: 'conv-session', createdAt: 1, role: 'user', status: 'success', content: [{ type: 'text', text: 'x'.repeat(60_000) }] },
        { id: 'a1', convId: 'conv-session', createdAt: 2, role: 'assistant', status: 'success', content: [{ type: 'text', text: 'previous answer' }] },
        { id: 'u2', convId: 'conv-session', createdAt: 3, role: 'user', status: 'success', content: [{ type: 'text', text: 'recent request' }] },
        { id: 'a2', convId: 'conv-session', createdAt: 4, role: 'assistant', status: 'success', content: [{ type: 'text', text: 'recent answer' }] },
      ]

      const secondResult = await runtime.startTask({
        conversationId: 'conv-session',
        prompt: 'inspect project again',
        modelId: 'model-1',
        workspacePath: '/workspace',
        mode: 'hybrid',
      })

      const loopCalls = vi.mocked(runAgentLoop).mock.calls
      const loopCall = loopCalls[loopCalls.length - 1]
      const loopOptions = loopCall?.[0].options
      expect(loopCall?.[0].onBeforeTurn).toBeUndefined()
      expect(loopOptions?.systemPrompt).toContain('Updated memory after compaction.')
      expect(loopOptions?.systemPrompt).not.toContain('Initial memory.')
      expect(loopOptions?.messages).toEqual([
        {
          role: 'user',
          content: [{
            type: 'text',
            text: [
              'Previous conversation history has been compressed into the following summary:',
              '<summary>',
              'Earlier context summary.',
              '</summary>',
              'Continue the task based on the above summary and subsequent conversation.',
            ].join('\n'),
          }],
        },
        { role: 'user', content: [{ type: 'text', text: 'recent request' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'recent answer' }] },
        { role: 'user', content: [{ type: 'text', text: 'inspect project again' }] },
      ])
      expect(store.createEventMessage).toHaveBeenCalledWith({
        convId: 'conv-session',
        role: 'event',
        status: 'loading',
        content: [{ type: 'text', text: '正在压缩上下文...' }],
        eventType: 'compaction',
      })
      expect(store.updateEventMessage).toHaveBeenCalledWith('event-msg-1', {
        role: 'event',
        status: 'success',
        content: [{ type: 'text', text: 'Earlier context summary.' }],
        eventType: 'compaction',
        compactedThroughMessageId: 'a1',
        modelInfo: {
          provider: 'provider',
          providerId: 'provider-1',
          model: 'test-model',
        },
        usage: {
          inputTokens: 12000,
          outputTokens: 300,
          totalTokens: 12300,
        },
      })
      expect(vi.mocked(store.createEventMessage).mock.invocationCallOrder[0])
        .toBeLessThan(vi.mocked(store.createUserMessage).mock.invocationCallOrder[1])
      expect(vi.mocked(store.updateEventMessage).mock.invocationCallOrder[0])
        .toBeLessThan(vi.mocked(store.createUserMessage).mock.invocationCallOrder[1])
      expect(readMemory).toHaveBeenCalledTimes(2)
      expect(readUserMemory).toHaveBeenCalledTimes(2)
      cleanupTasks([secondResult.taskId])
    })

    it('triggers automatic compaction from the latest assistant usage plus the pending user message', async () => {
      const conversation = {
        id: 'conv-session',
        title: 'Untitled',
        workspacePath: '/workspace',
        createdAt: 1,
        updatedAt: 1,
        settings: {
          modelId: 'model-1',
          systemPrompt: '',
          temperature: 0.7,
          maxTokens: 1024,
          compaction: { enabled: true, thresholdPercent: 70, keepRecentTokens: 8 },
        },
      }
      const historyMessages: Awaited<ReturnType<ISessionStore['getMessages']>> = [
        { id: 'u1', convId: 'conv-session', createdAt: 1, role: 'user', status: 'success', content: [{ type: 'text', text: 'old request' }] },
        {
          id: 'a1',
          convId: 'conv-session',
          createdAt: 2,
          role: 'assistant',
          status: 'success',
          content: [{ type: 'text', text: 'old answer' }],
          usage: { totalTokens: 6900 },
        },
        { id: 'u2', convId: 'conv-session', createdAt: 3, role: 'user', status: 'success', content: [{ type: 'text', text: 'recent request' }] },
      ]
      const store = createSessionStore({
        getConversation: vi.fn(async () => conversation),
        getConversationById: vi.fn(async () => conversation),
        getMessages: vi.fn(async () => historyMessages),
      })
      const config = createSessionConfig({
        sessionStore: store,
        modelCatalog: {
          getModelById: vi.fn(async () => ({
            id: 'model-1',
            model: 'test-model',
            name: 'Test Model',
            providerId: 'provider-1',
            contextLength: 10_000,
          })),
          getProviderById: vi.fn(async () => ({
            id: 'provider-1',
            name: 'provider',
            apiMode: 'openai' as const,
            apiKey: 'test-key',
            baseUrl: 'https://example.com',
            isOfficial: false,
            isEnabled: true,
            createdAt: 1,
            updatedAt: 1,
          })),
        },
        compactionStrategy: {
          summarize: vi.fn(async () => ({ text: 'usage-based summary' })),
        },
      })

      const runtime = new AgentRuntime(config)
      const result = await runtime.startTask({
        conversationId: 'conv-session',
        prompt: 'x'.repeat(400),
        modelId: 'model-1',
        workspacePath: '/workspace',
        mode: 'hybrid',
      })

      expect(store.createEventMessage).toHaveBeenCalledOnce()
      expect(store.updateEventMessage).toHaveBeenCalledWith('event-msg-1', expect.objectContaining({
        status: 'success',
        compactedThroughMessageId: 'a1',
      }))
      cleanupTasks([result.taskId])
    })

    it('updates the automatic compaction event to error when summarization fails without usage', async () => {
      const conversation = {
        id: 'conv-session',
        title: 'Untitled',
        workspacePath: '/workspace',
        createdAt: 1,
        updatedAt: 1,
        settings: {
          modelId: 'model-1',
          systemPrompt: '',
          temperature: 0.7,
          maxTokens: 1024,
          compaction: { enabled: true, thresholdPercent: 70, keepRecentTokens: 8 },
        },
      }
      const historyMessages: Awaited<ReturnType<ISessionStore['getMessages']>> = [
        { id: 'u1', convId: 'conv-session', createdAt: 1, role: 'user', status: 'success', content: [{ type: 'text', text: 'x'.repeat(60_000) }] },
        { id: 'a1', convId: 'conv-session', createdAt: 2, role: 'assistant', status: 'success', content: [{ type: 'text', text: 'previous answer' }] },
        { id: 'u2', convId: 'conv-session', createdAt: 3, role: 'user', status: 'success', content: [{ type: 'text', text: 'recent request' }] },
      ]
      const store = createSessionStore({
        getConversation: vi.fn(async () => conversation),
        getConversationById: vi.fn(async () => conversation),
        getMessages: vi.fn(async () => historyMessages),
      })
      const config = createSessionConfig({
        sessionStore: store,
        modelCatalog: {
          getModelById: vi.fn(async () => ({
            id: 'model-1',
            model: 'test-model',
            name: 'Test Model',
            providerId: 'provider-1',
            contextLength: 20_000,
          })),
          getProviderById: vi.fn(async () => ({
            id: 'provider-1',
            name: 'provider',
            apiMode: 'openai' as const,
            apiKey: 'test-key',
            baseUrl: 'https://example.com',
            isOfficial: false,
            isEnabled: true,
            createdAt: 1,
            updatedAt: 1,
          })),
        },
        compactionStrategy: {
          summarize: vi.fn(async () => {
            throw new Error('summary provider failed')
          }),
        },
      })

      const runtime = new AgentRuntime(config)
      const result = await runtime.startTask({
        conversationId: 'conv-session',
        prompt: 'inspect project',
        modelId: 'model-1',
        workspacePath: '/workspace',
        mode: 'hybrid',
      })

      expect(store.createEventMessage).toHaveBeenCalledWith({
        convId: 'conv-session',
        role: 'event',
        status: 'loading',
        content: [{ type: 'text', text: '正在压缩上下文...' }],
        eventType: 'compaction',
      })
      expect(store.updateEventMessage).toHaveBeenCalledWith('event-msg-1', {
        role: 'event',
        status: 'error',
        content: [{ type: 'text', text: 'summary provider failed' }],
        eventType: 'compaction',
        modelInfo: {
          provider: 'provider',
          providerId: 'provider-1',
          model: 'test-model',
        },
        usage: undefined,
      })
      expect(vi.mocked(store.updateEventMessage).mock.invocationCallOrder[0])
        .toBeLessThan(vi.mocked(store.createUserMessage).mock.invocationCallOrder[0])
      cleanupTasks([result.taskId])
    })

    it('ignores assistant usage before the latest compaction checkpoint', async () => {
      const conversation = {
        id: 'conv-session',
        title: 'Untitled',
        workspacePath: '/workspace',
        createdAt: 1,
        updatedAt: 1,
        settings: {
          modelId: 'model-1',
          systemPrompt: '',
          temperature: 0.7,
          maxTokens: 1024,
          compaction: { enabled: true, thresholdPercent: 70, keepRecentTokens: 8 },
        },
      }
      const historyMessages: Awaited<ReturnType<ISessionStore['getMessages']>> = [
        {
          id: 'a1',
          convId: 'conv-session',
          createdAt: 1,
          role: 'assistant',
          status: 'success',
          content: [{ type: 'text', text: 'old answer' }],
          usage: { totalTokens: 9000 },
        },
        {
          id: 'evt-1',
          convId: 'conv-session',
          createdAt: 2,
          role: 'event',
          status: 'success',
          eventType: 'compaction',
          compactedThroughMessageId: 'a1',
          content: [{ type: 'text', text: 'short summary' }],
        },
        { id: 'u2', convId: 'conv-session', createdAt: 3, role: 'user', status: 'success', content: [{ type: 'text', text: 'recent request' }] },
        { id: 'a2', convId: 'conv-session', createdAt: 4, role: 'assistant', status: 'success', content: [{ type: 'text', text: 'recent answer' }] },
      ]
      const store = createSessionStore({
        getConversation: vi.fn(async () => conversation),
        getConversationById: vi.fn(async () => conversation),
        getMessages: vi.fn(async () => historyMessages),
      })
      const config = createSessionConfig({
        sessionStore: store,
        modelCatalog: {
          getModelById: vi.fn(async () => ({
            id: 'model-1',
            model: 'test-model',
            name: 'Test Model',
            providerId: 'provider-1',
            contextLength: 10_000,
          })),
          getProviderById: vi.fn(async () => ({
            id: 'provider-1',
            name: 'provider',
            apiMode: 'openai' as const,
            apiKey: 'test-key',
            baseUrl: 'https://example.com',
            isOfficial: false,
            isEnabled: true,
            createdAt: 1,
            updatedAt: 1,
          })),
        },
        compactionStrategy: {
          summarize: vi.fn(async () => ({ text: 'unused summary' })),
        },
      })

      const runtime = new AgentRuntime(config)
      const result = await runtime.startTask({
        conversationId: 'conv-session',
        prompt: 'inspect project',
        modelId: 'model-1',
        workspacePath: '/workspace',
        mode: 'hybrid',
      })

      expect(store.createEventMessage).not.toHaveBeenCalled()
      expect(store.updateEventMessage).not.toHaveBeenCalled()
      cleanupTasks([result.taskId])
    })

    it('does not create user message when conversation already has an active task', async () => {
      const store = createSessionStore()
      const config = createSessionConfig({ sessionStore: store })
      const runtime = new AgentRuntime(config)
      const running = await runtime.startTask(createValidStartInput({ conversationId: 'conv-session' }))

      await expect(runtime.startTask({
        conversationId: 'conv-session',
        prompt: 'run it',
        modelId: 'model-1',
        workspacePath: '/workspace',
        mode: 'hybrid',
      })).rejects.toThrow('AGENT_TASK_ALREADY_RUNNING')

      expect(store.createUserMessage).not.toHaveBeenCalled()
      cleanupTasks([running.taskId])
    })
  })

  describe('injectSteering', () => {
    it('enqueues steering and stores pending message (deferred persistence)', async () => {
      const store = createSessionStore()
      const eventEmitter = createMockEmitter()
      const runtime = new AgentRuntime(createSessionConfig({ eventEmitter, sessionStore: store }))
      const running = await runtime.startTask({
        conversationId: 'conv-session',
        prompt: 'inspect project',
        modelId: 'model-1',
        workspacePath: '/workspace',
        mode: 'hybrid',
      })

      // Record calls from startTask so we can ignore them
      const callsBefore = (store.createUserMessage as ReturnType<typeof vi.fn>).mock.calls.length

      await runtime.injectSteering('conv-session', 'fix types first')

      // Should NOT persist to DB immediately — deferred until after tool results
      expect(store.createUserMessage).toHaveBeenCalledTimes(callsBefore)

      // Should store in pending list on the task
      const task = taskStore.get(running.taskId)
      expect(task?.pendingSteeringMessages).toEqual([
        { text: 'fix types first', turnId: 'user-msg-1' },
      ])

      // Should still enqueue for the agent loop
      expect(taskStore.dequeueSteeringInputs(running.taskId)).toEqual([
        { text: 'fix types first', turnId: 'user-msg-1' },
      ])
      cleanupTasks([running.taskId])
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
