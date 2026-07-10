import { describe, expect, it, vi } from 'vitest'
import { AgentRuntime } from '../AgentRuntime'
import { runAgentLoop } from '../loop/agentLoop'
import { ToolRegistry } from '../tools/toolRegistry'
import type { AgentRuntimeConfig, AgentRuntimeStartTaskOptions, IAgentEventEmitter, ILogger, ISessionStore } from '@ant-chat/shared'
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
      providerId: 'provider-1',
      systemPrompt: '',
      temperature: 0.7,
      maxTokens: 1024,
    },
  }
  const userMessage = {
    id: 'user-msg-1',
    convId: conversation.id,
    createdAt: 2,
    role: 'user' as const,
    status: 'success' as const,
    content: [{ type: 'text' as const, text: 'inspect project' }],
    turnId: undefined,
  }
  return {
    getConversation: vi.fn(async () => conversation),
    getConversationById: vi.fn(async () => conversation),
    createConversation: vi.fn(async () => conversation),
    updateConversation: vi.fn(async () => conversation),
    listConversations: vi.fn(async () => [conversation]),
    getMessages: vi.fn(async () => [userMessage]),
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
  return ({
    ...createConfig(),
    sessionStore: createSessionStore(),
    compactionStrategy: { summarize: vi.fn() },
    ...overrides,
  } as AgentRuntimeConfig)
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

function createValidSessionStartInput(overrides: Partial<AgentRuntimeStartTaskOptions> = {}): AgentRuntimeStartTaskOptions {
  return {
    conversationId: 'conv-session',
    userMessageId: 'user-msg-1',
    prompt: 'inspect project',
    model: { id: 'model-1', model: 'gpt-4', name: 'GPT-4', providerId: 'provider-1', contextLength: 128_000 },
    provider: { id: 'provider-1', name: 'Provider 1', apiMode: 'openai', baseUrl: 'https://api.example.com', isOfficial: true, isEnabled: true, hasApiKey: true, createdAt: 0, updatedAt: 0 },
    workspacePath: '/workspace',
    mode: 'hybrid',
    aiProvider: { streamModel: vi.fn(), complete: vi.fn() },
    ...overrides,
  }
}

function createPersistedUserMessage(text: string, id = 'user-msg-1') {
  return {
    id,
    convId: 'conv-session',
    createdAt: 10,
    role: 'user' as const,
    status: 'success' as const,
    content: [{ type: 'text' as const, text }],
    turnId: undefined,
  }
}

describe('agentRuntime 行为', () => {
  describe('startTask 行为', () => {
    it('不同 runtime 实例的 task 状态互不影响', async () => {
      const firstRuntime = new AgentRuntime(createConfig())
      const secondRuntime = new AgentRuntime(createConfig())

      const first = await firstRuntime.startPreparedTask(createValidStartInput())
      const second = await secondRuntime.startPreparedTask(createValidStartInput())

      expect(firstRuntime.listActiveTasks()).toEqual([
        expect.objectContaining({ taskId: first.taskId }),
      ])
      expect(secondRuntime.listActiveTasks()).toEqual([
        expect.objectContaining({ taskId: second.taskId }),
      ])
    })

    it('返回 taskId 并在 store 中创建任务', async () => {
      const config = createConfig()
      const runtime = new AgentRuntime(config)
      const input = createValidStartInput()

      const result = await runtime.startPreparedTask(input)

      expect(result.taskId).toBeDefined()
      expect(typeof result.taskId).toBe('string')
      expect(result.taskId.length).toBeGreaterThan(0)

      const task = runtime.getTask(result.taskId)
      expect(task.status).toBe('running')
      expect(task.conversationId).toBe('conv-1')
      expect(task.prompt).toBe('test prompt')
    })

    it('校验缺失的 conversationId', async () => {
      const runtime = new AgentRuntime(createConfig())
      await expect(
        runtime.startPreparedTask(createValidStartInput({ conversationId: '' })),
      ).rejects.toThrow('missing conversationId')
    })

    it('校验缺失的 userMessageId', async () => {
      const runtime = new AgentRuntime(createConfig())
      await expect(
        runtime.startPreparedTask(createValidStartInput({ userMessageId: '' })),
      ).rejects.toThrow('missing userMessageId')
    })

    it('校验缺失的 prompt', async () => {
      const runtime = new AgentRuntime(createConfig())
      await expect(
        runtime.startPreparedTask(createValidStartInput({ prompt: '' })),
      ).rejects.toThrow('missing prompt')
    })

    it('一次性校验多个缺失字段', async () => {
      const runtime = new AgentRuntime(createConfig())
      await expect(
        runtime.startPreparedTask(createValidStartInput({ conversationId: '', userMessageId: '' })),
      ).rejects.toThrow('missing conversationId, userMessageId')
    })

    it('启动任务时发出 taskUpdated 事件', async () => {
      const emitter = createMockEmitter()
      const config: AgentRuntimeConfig = { eventEmitter: emitter, logger: createMockLogger() }
      const runtime = new AgentRuntime(config)

      const result = await runtime.startPreparedTask(createValidStartInput())
      expect(emitter.emitTaskUpdated).toHaveBeenCalledTimes(1)
      expect(emitter.emitTaskUpdated).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: result.taskId,
          status: 'running',
          conversationId: 'conv-1',
        }),
      )
    })

    it('阻止同一会话重复启动任务', async () => {
      const runtime = new AgentRuntime(createConfig())
      const _result1 = await runtime.startPreparedTask(createValidStartInput())

      await expect(
        runtime.startPreparedTask(createValidStartInput()),
      ).rejects.toThrow('AGENT_TASK_ALREADY_RUNNING')
    })

    it('通过高层 task 参数读取 session 状态并启动 loop', async () => {
      const store = createSessionStore()
      const config = createSessionConfig({ sessionStore: store })
      const runtime = new AgentRuntime(config)

      const result = await runtime.startSessionTask(createValidSessionStartInput({
        prompt: ' inspect project ',
        modelSettings: {
          systemPrompt: '',
          temperature: 0.7,
          maxTokens: 1024,
        },
      }))

      expect(store.getConversation).toHaveBeenCalledWith('conv-session')
      expect(store.createConversation).not.toHaveBeenCalled()
      expect(store.createUserMessage).not.toHaveBeenCalled()
      expect(result).toEqual(expect.objectContaining({
        conversationId: 'conv-session',
        userMessageId: 'user-msg-1',
      }))
    })

    it('失败结束时保留已经写入的 assistant 文本内容', async () => {
      const store = createSessionStore()
      const runtime = new AgentRuntime(createSessionConfig({ sessionStore: store }))

      const _result = await runtime.startSessionTask({
        prompt: 'inspect project',
        conversationId: 'conv-session',
        userMessageId: 'user-msg-1',
        model: { id: 'model-1', model: 'gpt-4', name: 'GPT-4', providerId: 'provider-1', contextLength: 128_000 },
        provider: { id: 'provider-1', name: 'Provider 1', apiMode: 'openai', baseUrl: 'https://api.example.com', isOfficial: true, isEnabled: true, hasApiKey: true, createdAt: 0, updatedAt: 0 },
        workspacePath: '/workspace',
        mode: 'hybrid',
        aiProvider: { streamModel: vi.fn(), complete: vi.fn() },
      })
      const loopCalls = vi.mocked(runAgentLoop).mock.calls
      const loopCall = loopCalls[loopCalls.length - 1]
      expect(loopCall).toBeDefined()

      const eventEmitter = loopCall![0].config.eventEmitter
      await eventEmitter.emitTurnStarted({
        conversationId: 'conv-session',
        model: { name: 'test-model', provider: 'provider', providerId: 'provider-1' },
      })
      await eventEmitter.emitTurnChunk({
        conversationId: 'conv-session',
        chunk: { content: [{ type: 'text', text: '已完成部分回答' }] },
        accumulatedText: '已完成部分回答',
      })
      await eventEmitter.emitTurnFinished({
        conversationId: 'conv-session',
        turnId: 'user-msg-1',
        text: '模型请求失败',
        status: 'error',
      })

      expect(store.updateAssistantMessage).toHaveBeenLastCalledWith('assistant-msg-1', expect.objectContaining({
        status: 'error',
        content: [
          { type: 'text', text: '已完成部分回答' },
          { type: 'error', error: '模型请求失败' },
        ],
      }))
    })

    it('高层 task 参数缺少 model 时拒绝启动', async () => {
      const store = createSessionStore()
      const runtime = new AgentRuntime(createSessionConfig({ sessionStore: store }))

      await expect(runtime.startSessionTask(createValidSessionStartInput({
        model: { id: '', model: '', name: '', providerId: '', contextLength: 0 },
      }))).rejects.toThrow('missing model')
      expect(store.createUserMessage).not.toHaveBeenCalled()
    })

    it('高层 task 参数缺少 workspacePath 时拒绝启动', async () => {
      const store = createSessionStore()
      const runtime = new AgentRuntime(createSessionConfig({ sessionStore: store }))

      await expect(runtime.startSessionTask(createValidSessionStartInput({
        workspacePath: '',
      }))).rejects.toThrow('missing workspacePath')
      expect(store.createUserMessage).not.toHaveBeenCalled()
    })

    it('找不到会话时不创建用户消息', async () => {
      const store = createSessionStore({
        getConversation: vi.fn(async () => null),
      })
      const runtime = new AgentRuntime(createSessionConfig({
        sessionStore: store,
      }))

      await expect(runtime.startSessionTask(createValidSessionStartInput())).rejects.toThrow('Conversation not found: conv-session')
      expect(store.createUserMessage).not.toHaveBeenCalled()
    })

    it('找不到用户消息时不创建用户消息', async () => {
      const store = createSessionStore({
        getMessages: vi.fn(async () => []),
      })
      const runtime = new AgentRuntime(createSessionConfig({
        sessionStore: store,
      }))

      await expect(runtime.startSessionTask(createValidSessionStartInput())).rejects.toThrow('User message not found: user-msg-1')
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

      const _result = await runtime.startSessionTask(createValidSessionStartInput())

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

      const firstLoopCall = vi.mocked(runAgentLoop).mock.calls[vi.mocked(runAgentLoop).mock.calls.length - 1]
      firstLoopCall?.[0].finishTask?.()

      userMarkdown = '§Prefer verbose English.'
      memoryMarkdown = '§Use npm test.'
      const _secondResult = await runtime.startSessionTask(createValidSessionStartInput({
        prompt: 'inspect project again',
      }))

      const secondCalls = vi.mocked(runAgentLoop).mock.calls
      const secondCall = secondCalls[secondCalls.length - 1]
      expect(secondCall?.[0].options.systemPrompt).toContain('Prefer concise Chinese.')
      expect(secondCall?.[0].options.systemPrompt).toContain('Use pnpm check.')
      expect(secondCall?.[0].options.systemPrompt).not.toContain('Prefer verbose English.')
      expect(secondCall?.[0].options.systemPrompt).not.toContain('Use npm test.')
    })

    it('启动 loop 前压缩持久化历史并刷新 memory', async () => {
      const conversation = {
        id: 'conv-session',
        title: 'Untitled',
        workspacePath: '/workspace',
        createdAt: 1,
        updatedAt: 1,
        settings: {
          modelId: 'model-1',
          providerId: 'provider-1',
          systemPrompt: '',
          temperature: 0.7,
          maxTokens: 1024,
          compaction: { enabled: true, thresholdPercent: 70, keepRecentTokens: 16 },
        },
      }
      let historyMessages: Awaited<ReturnType<ISessionStore['getMessages']>> = [
        createPersistedUserMessage('inspect project first'),
      ]
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

      const _firstResult = await runtime.startSessionTask(createValidSessionStartInput({
        prompt: 'inspect project first',
        model: { id: 'model-1', model: 'gpt-4', name: 'GPT-4', providerId: 'provider-1', contextLength: 20_000 },
      }))
      const firstLoopCall = vi.mocked(runAgentLoop).mock.calls[vi.mocked(runAgentLoop).mock.calls.length - 1]
      firstLoopCall?.[0].finishTask?.()

      memoryMarkdown = '§Updated memory after compaction.'
      historyMessages = [
        { id: 'u1', convId: 'conv-session', createdAt: 1, role: 'user', status: 'success', content: [{ type: 'text', text: 'x'.repeat(60_000) }] },
        { id: 'a1', convId: 'conv-session', createdAt: 2, role: 'assistant', status: 'success', content: [{ type: 'text', text: 'previous answer' }] },
        { id: 'u2', convId: 'conv-session', createdAt: 3, role: 'user', status: 'success', content: [{ type: 'text', text: 'recent request' }] },
        { id: 'a2', convId: 'conv-session', createdAt: 4, role: 'assistant', status: 'success', content: [{ type: 'text', text: 'recent answer' }] },
        createPersistedUserMessage('inspect project again'),
      ]

      const _secondResult = await runtime.startSessionTask(createValidSessionStartInput({
        prompt: 'inspect project again',
        model: { id: 'model-1', model: 'gpt-4', name: 'GPT-4', providerId: 'provider-1', contextLength: 20_000 },
      }))

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
          provider: 'Provider 1',
          providerId: 'provider-1',
          model: 'gpt-4',
        },
        usage: {
          inputTokens: 12000,
          outputTokens: 300,
          totalTokens: 12300,
        },
      })
      expect(readMemory).toHaveBeenCalledTimes(2)
      expect(readUserMemory).toHaveBeenCalledTimes(2)
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
          providerId: 'provider-1',
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
        createPersistedUserMessage('x'.repeat(400)),
      ]
      const store = createSessionStore({
        getConversation: vi.fn(async () => conversation),
        getConversationById: vi.fn(async () => conversation),
        getMessages: vi.fn(async () => historyMessages),
      })
      const config = createSessionConfig({
        sessionStore: store,
        compactionStrategy: {
          summarize: vi.fn(async () => ({ text: 'usage-based summary' })),
        },
      })

      const runtime = new AgentRuntime(config)
      const _result = await runtime.startSessionTask(createValidSessionStartInput({
        prompt: 'x'.repeat(400),
        model: { id: 'model-1', model: 'gpt-4', name: 'GPT-4', providerId: 'provider-1', contextLength: 10_000 },
      }))

      expect(store.createEventMessage).toHaveBeenCalledOnce()
      expect(store.updateEventMessage).toHaveBeenCalledWith('event-msg-1', expect.objectContaining({
        status: 'success',
        compactedThroughMessageId: 'a1',
      }))
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
          providerId: 'provider-1',
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
        createPersistedUserMessage('inspect project'),
      ]
      const store = createSessionStore({
        getConversation: vi.fn(async () => conversation),
        getConversationById: vi.fn(async () => conversation),
        getMessages: vi.fn(async () => historyMessages),
      })
      const config = createSessionConfig({
        sessionStore: store,
        compactionStrategy: {
          summarize: vi.fn(async () => {
            throw new Error('summary provider failed')
          }),
        },
      })

      const runtime = new AgentRuntime(config)
      const _result = await runtime.startSessionTask(createValidSessionStartInput({
        model: { id: 'model-1', model: 'gpt-4', name: 'GPT-4', providerId: 'provider-1', contextLength: 20_000 },
      }))

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
          provider: 'Provider 1',
          providerId: 'provider-1',
          model: 'gpt-4',
        },
        usage: undefined,
      })
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
          providerId: 'provider-1',
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
        createPersistedUserMessage('inspect project'),
      ]
      const store = createSessionStore({
        getConversation: vi.fn(async () => conversation),
        getConversationById: vi.fn(async () => conversation),
        getMessages: vi.fn(async () => historyMessages),
      })
      const config = createSessionConfig({
        sessionStore: store,
        compactionStrategy: {
          summarize: vi.fn(async () => ({ text: 'unused summary' })),
        },
      })

      const runtime = new AgentRuntime(config)
      const _result = await runtime.startSessionTask(createValidSessionStartInput({
        model: { id: 'model-1', model: 'gpt-4', name: 'GPT-4', providerId: 'provider-1', contextLength: 10_000 },
      }))

      expect(store.createEventMessage).not.toHaveBeenCalled()
      expect(store.updateEventMessage).not.toHaveBeenCalled()
    })

    it('会话已有活跃任务时不创建用户消息', async () => {
      const store = createSessionStore()
      const config = createSessionConfig({ sessionStore: store })
      const runtime = new AgentRuntime(config)
      const _running = await runtime.startPreparedTask(createValidStartInput({ conversationId: 'conv-session' }))

      await expect(runtime.startSessionTask(createValidSessionStartInput({
        prompt: 'run it',
      }))).rejects.toThrow('AGENT_TASK_ALREADY_RUNNING')

      expect(store.createUserMessage).not.toHaveBeenCalled()
    })
  })

  describe('injectSteering 行为', () => {
    it('追加 steering 并暂存待持久化消息', async () => {
      const store = createSessionStore()
      const eventEmitter = createMockEmitter()
      const runtime = new AgentRuntime(createSessionConfig({ eventEmitter, sessionStore: store }))
      const _running = await runtime.startSessionTask(createValidSessionStartInput())

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
    })
  })

  describe('getTask 行为', () => {
    it('返回已存在任务的快照', async () => {
      const runtime = new AgentRuntime(createConfig())
      const result = await runtime.startPreparedTask(createValidStartInput())
      const snapshot = runtime.getTask(result.taskId)
      expect(snapshot.taskId).toBe(result.taskId)
      expect(snapshot.status).toBe('running')
    })

    it('taskId 不存在时抛错', () => {
      const runtime = new AgentRuntime(createConfig())
      expect(() => runtime.getTask('nonexistent')).toThrow('Task not found')
    })
  })

  describe('listActiveTasks 行为', () => {
    it('列出指定会话的活跃任务', async () => {
      const runtime = new AgentRuntime(createConfig())
      const result = await runtime.startPreparedTask(
        createValidStartInput({ conversationId: 'conv-list' }),
      )

      const tasks = runtime.listActiveTasks('conv-list')
      expect(tasks).toHaveLength(1)
      expect(tasks[0].taskId).toBe(result.taskId)

      expect(runtime.listActiveTasks('other-conversation')).toHaveLength(0)
    })

    it('不传 conversationId 时列出全部活跃任务', async () => {
      const config = createConfig()
      const runtime = new AgentRuntime(config)
      const _r1 = await runtime.startPreparedTask(
        createValidStartInput({ conversationId: 'conv-a' }),
      )
      const _r2 = await runtime.startPreparedTask(
        createValidStartInput({ conversationId: 'conv-b' }),
      )

      const all = runtime.listActiveTasks()
      expect(all).toHaveLength(2)
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
      const result = await runtime.startPreparedTask(createValidStartInput())
      runtime.cancelTask({ taskId: result.taskId })
      expect(runtime.getTask(result.taskId).status).toBe('cancelled')
    })
  })
})
