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
    createUserMessage: vi.fn(async data => ({
      id: data.id ?? 'user-msg-1',
      convId: data.convId,
      createdAt: 2,
      role: 'user' as const,
      status: 'success' as const,
      content: data.content,
      turnId: data.turnId,
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

describe('agentRuntime 行为', () => {
  describe('startTask 行为', () => {
    it('返回 taskId 并在 store 中创建任务', async () => {
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

    it('校验缺失的 conversationId', async () => {
      const runtime = new AgentRuntime(createConfig())
      await expect(
        runtime.startTask(createValidStartInput({ conversationId: '' })),
      ).rejects.toThrow('missing conversationId')
    })

    it('校验缺失的 userMessageId', async () => {
      const runtime = new AgentRuntime(createConfig())
      await expect(
        runtime.startTask(createValidStartInput({ userMessageId: '' })),
      ).rejects.toThrow('missing userMessageId')
    })

    it('校验缺失的 prompt', async () => {
      const runtime = new AgentRuntime(createConfig())
      await expect(
        runtime.startTask(createValidStartInput({ prompt: '' })),
      ).rejects.toThrow('missing prompt')
    })

    it('一次性校验多个缺失字段', async () => {
      const runtime = new AgentRuntime(createConfig())
      await expect(
        runtime.startTask(createValidStartInput({ conversationId: '', userMessageId: '' })),
      ).rejects.toThrow('missing conversationId, userMessageId')
    })

    it('启动任务时发出 taskUpdated 事件', async () => {
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

    it('阻止同一会话重复启动任务', async () => {
      const runtime = new AgentRuntime(createConfig())
      const result1 = await runtime.startTask(createValidStartInput())

      await expect(
        runtime.startTask(createValidStartInput()),
      ).rejects.toThrow('AGENT_TASK_ALREADY_RUNNING')

      cleanupTasks([result1.taskId])
    })

    it('通过高层 task 参数创建 session 状态并启动 loop', async () => {
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

    it('高层 task 参数缺少 modelId 时拒绝启动', async () => {
      const store = createSessionStore()
      const runtime = new AgentRuntime(createSessionConfig({ sessionStore: store }))

      await expect(runtime.startTask({
        prompt: 'inspect project',
        modelId: '',
        workspacePath: '/workspace',
        mode: 'hybrid',
      })).rejects.toThrow('missing modelId')
      expect(store.createUserMessage).not.toHaveBeenCalled()
    })

    it('高层 task 参数缺少 workspacePath 时拒绝启动', async () => {
      const store = createSessionStore()
      const runtime = new AgentRuntime(createSessionConfig({ sessionStore: store }))

      await expect(runtime.startTask({
        prompt: 'inspect project',
        modelId: 'model-1',
        workspacePath: '',
        mode: 'hybrid',
      })).rejects.toThrow('missing workspacePath')
      expect(store.createUserMessage).not.toHaveBeenCalled()
    })

    it('找不到模型时不创建用户消息', async () => {
      const store = createSessionStore()
      const runtime = new AgentRuntime(createSessionConfig({
        sessionStore: store,
        modelCatalog: {
          getModelById: vi.fn(async () => null),
          getProviderById: vi.fn(),
        },
      }))

      await expect(runtime.startTask({
        prompt: 'inspect project',
        modelId: 'missing-model',
        workspacePath: '/workspace',
        mode: 'hybrid',
      })).rejects.toThrow('Model not found: missing-model')
      expect(store.createUserMessage).not.toHaveBeenCalled()
    })

    it('找不到模型 provider 时不创建用户消息', async () => {
      const store = createSessionStore()
      const runtime = new AgentRuntime(createSessionConfig({
        sessionStore: store,
        modelCatalog: {
          getModelById: vi.fn(async () => ({
            id: 'model-1',
            model: 'test-model',
            name: 'Test Model',
            providerId: 'missing-provider',
            contextLength: 128_000,
          })),
          getProviderById: vi.fn(async () => null),
        },
      }))

      await expect(runtime.startTask({
        prompt: 'inspect project',
        modelId: 'model-1',
        workspacePath: '/workspace',
        mode: 'hybrid',
      })).rejects.toThrow('Provider not found for model: test-model')
      expect(store.createUserMessage).not.toHaveBeenCalled()
    })

    it('在 loop system prompt 中使用会话级 USER.md 和 MEMORY.md 快照', async () => {
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

    it('写入新用户消息前压缩持久化历史并刷新 memory', async () => {
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

    it('基于最近 assistant usage 和待发送用户消息触发自动压缩', async () => {
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

    it('摘要失败且没有 usage 时将自动压缩 event 更新为 error', async () => {
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

    it('忽略最近压缩检查点之前的 assistant usage', async () => {
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

    it('会话已有活跃任务时不创建用户消息', async () => {
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

  describe('injectSteering 行为', () => {
    it('追加 steering 并暂存待持久化消息', async () => {
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

      const message = await runtime.injectSteering('conv-session', 'fix types first')

      // Should NOT persist to DB immediately — deferred until after tool results
      expect(store.createUserMessage).toHaveBeenCalledTimes(callsBefore)
      expect(message).toMatchObject({
        convId: 'conv-session',
        role: 'user',
        status: 'success',
        content: [{ type: 'text', text: 'fix types first' }],
        turnId: 'user-msg-1',
      })
      expect(message.id).toMatch(/^msg-/)

      // Should store in pending list on the task
      const task = taskStore.get(running.taskId)
      expect(task?.pendingSteeringMessages).toEqual([
        { id: message.id, text: 'fix types first', turnId: 'user-msg-1' },
      ])

      // Should still enqueue for the agent loop
      expect(taskStore.dequeueSteeringInputs(running.taskId)).toEqual([
        { text: 'fix types first', turnId: 'user-msg-1' },
      ])

      const loopCalls = vi.mocked(runAgentLoop).mock.calls
      const loopCall = loopCalls[loopCalls.length - 1]
      expect(loopCall).toBeDefined()
      await loopCall![0].config.eventEmitter.emitTurnToolResults!({
        conversationId: 'conv-session',
        results: [],
      })
      expect(store.createUserMessage).toHaveBeenLastCalledWith({
        id: message.id,
        convId: 'conv-session',
        role: 'user',
        status: 'success',
        content: [{ type: 'text', text: 'fix types first' }],
        turnId: 'user-msg-1',
      })
      expect(eventEmitter.emitMessageUpdated).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: message.id }),
      )
      cleanupTasks([running.taskId])
    })
  })

  describe('getTask 行为', () => {
    it('返回已存在任务的快照', async () => {
      const runtime = new AgentRuntime(createConfig())
      const result = await runtime.startTask(createValidStartInput())
      const snapshot = runtime.getTask(result.taskId)
      expect(snapshot.taskId).toBe(result.taskId)
      expect(snapshot.status).toBe('running')
      cleanupTasks([result.taskId])
    })

    it('taskId 不存在时抛错', () => {
      const runtime = new AgentRuntime(createConfig())
      expect(() => runtime.getTask('nonexistent')).toThrow('Task not found')
    })
  })

  describe('listActiveTasks 行为', () => {
    it('列出指定会话的活跃任务', async () => {
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

    it('不传 conversationId 时列出全部活跃任务', async () => {
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

  describe('approvePendingAction 行为', () => {
    it('委托 approvalController.approvePendingAction 处理审批', () => {
      const runtime = new AgentRuntime(createConfig())

      // This should throw because there's no task awaiting approval
      expect(() =>
        runtime.approvePendingAction({ taskId: 'nonexistent', actionId: 'action-1' }),
      ).toThrow('Task not found')
    })
  })

  describe('rejectPendingAction 行为', () => {
    it('委托 approvalController.rejectPendingAction 处理拒绝', () => {
      const runtime = new AgentRuntime(createConfig())
      expect(() =>
        runtime.rejectPendingAction({ taskId: 'nonexistent', actionId: 'action-1' }),
      ).toThrow('Task not found')
    })
  })

  describe('cancelTask 行为', () => {
    it('委托 approvalController.cancelTask 处理取消', () => {
      const runtime = new AgentRuntime(createConfig())
      expect(() => runtime.cancelTask({ taskId: 'nonexistent' })).toThrow('Task not found')
    })

    it('取消正在运行的任务', async () => {
      const runtime = new AgentRuntime(createConfig())
      const result = await runtime.startTask(createValidStartInput())
      runtime.cancelTask({ taskId: result.taskId })
      const task = taskStore.get(result.taskId)
      expect(task?.snapshot.status).toBe('cancelled')
      cleanupTasks([result.taskId])
    })
  })
})
