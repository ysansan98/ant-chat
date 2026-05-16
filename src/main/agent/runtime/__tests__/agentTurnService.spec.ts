import { beforeEach, describe, expect, it, vi } from 'vitest'
import { startAgentTurn } from '../agentTurnService'

const mocks = vi.hoisted(() => ({
  addConversation: vi.fn(),
  addMessage: vi.fn(),
  getConversationById: vi.fn(),
  listActiveTasks: vi.fn(),
  startTask: vi.fn(),
  getModelById: vi.fn(),
  getProviderById: vi.fn(),
  createDbAIProvider: vi.fn(),
  getConvById: vi.fn(),
  getMessagesByConvId: vi.fn(),
  electronToolProvider: vi.fn(),
  getLogsDir: vi.fn(),
  createElectronEventEmitter: vi.fn(),
}))

vi.mock('@main/db/services', () => ({
  addConversation: mocks.addConversation,
  addMessage: mocks.addMessage,
  getConversationById: mocks.getConversationById,
}))

vi.mock('@main/store/workspace', () => ({
  WorkspaceStore: {
    getInstance: () => ({
      getCurrentWorkspacePath: () => '/workspace',
    }),
  },
}))

vi.mock('@main/agent/adapters/dbModelResolver.adapter', () => ({
  dbModelResolver: {
    getModelById: (...args: any[]) => mocks.getModelById(...args),
    getProviderById: (...args: any[]) => mocks.getProviderById(...args),
  },
}))

vi.mock('@main/agent/adapters/aiProviderFactory.adapter', () => ({
  createDbAIProvider: (...args: any[]) => mocks.createDbAIProvider(...args),
}))

vi.mock('@main/agent/adapters/conversationQuery.adapter', () => ({
  createDbConversationQuery: () => ({
    getConversationById: (...args: any[]) => mocks.getConvById(...args),
    getMessagesByConvId: (...args: any[]) => mocks.getMessagesByConvId(...args),
  }),
}))

vi.mock('@main/agent/adapters/toolProvider.adapter', () => ({
  electronToolProvider: (...args: any[]) => mocks.electronToolProvider(...args),
}))

vi.mock('@main/agent/adapters/electronPathProvider.adapter', () => ({
  electronPathProvider: {
    getLogsDir: () => mocks.getLogsDir(),
  },
}))

vi.mock('@main/agent/adapters/electronEventEmitter.adapter', () => ({
  createElectronEventEmitter: () => mocks.createElectronEventEmitter(),
}))

vi.mock('@main/agent/adapters/electronLogger.adapter', () => ({
  electronLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@main/agent/adapters/compactionStrategy.adapter', () => ({
  createCompactionStrategy: () => ({
    summarize: vi.fn(),
  }),
}))

vi.mock('@ant-chat/agent-runtime', () => ({
  AgentRuntime: class {
    listActiveTasks = mocks.listActiveTasks
    startTask = mocks.startTask
  },
  buildPromptWithTurnContext: vi.fn((opts: { prompt: string }) => opts.prompt),
  buildConversationContextMessages: vi.fn(() => []),
  createLoopSystemPrompt: vi.fn(() => 'system prompt'),
  compactMessages: vi.fn(),
  createAgentLogger: vi.fn(() => ({
    appendAgentLog: vi.fn().mockResolvedValue('/logs/c1/m1.jsonl'),
  })),
  DEFAULT_COMPACTION_SETTINGS: { enabled: true, thresholdPercent: 70, keepRecentPairs: 3 },
  estimateContextTokens: vi.fn(() => 1000),
  getContextWindow: vi.fn(() => 128000),
}))

describe('agentTurnService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.addConversation.mockResolvedValue({
      id: 'c1',
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
    })
    mocks.addMessage.mockResolvedValue({ id: 'm1', convId: 'c1' })
    mocks.getConversationById.mockResolvedValue({ id: 'c1', title: 'Existing' })
    mocks.listActiveTasks.mockReturnValue([])
    mocks.startTask.mockResolvedValue({ taskId: 't1' })
    mocks.getModelById.mockResolvedValue({
      id: 'model-1',
      model: 'test-model',
      name: 'Test Model',
      serviceProviderId: 'p1',
    })
    mocks.getProviderById.mockResolvedValue({
      id: 'p1',
      name: 'Test Provider',
      apiMode: 'openai',
    })
    mocks.createDbAIProvider.mockResolvedValue({ streamModel: vi.fn(), complete: vi.fn() })
    mocks.getConvById.mockResolvedValue({ id: 'c1', settings: {} })
    mocks.getMessagesByConvId.mockResolvedValue([])
    mocks.electronToolProvider.mockResolvedValue([])
    mocks.getLogsDir.mockReturnValue('/logs')
    mocks.createElectronEventEmitter.mockReturnValue({
      emitTaskUpdated: vi.fn(),
      emitApprovalRequired: vi.fn(),
      emitTurnStarted: vi.fn(),
      emitTurnChunk: vi.fn(),
      emitTurnToolCalls: vi.fn(),
      emitTurnFinished: vi.fn(),
      emitCompactionSaved: vi.fn(),
    })
  })

  it('creates conversation, user message, and agent task for a new turn', async () => {
    const result = await startAgentTurn({
      prompt: '  inspect project  ',
      chatSettings: {
        modelId: 'model-1',
        systemPrompt: '',
        temperature: 0.7,
        maxTokens: 1024,
        features: {
          onlineSearch: false,
          enableMCP: false,
        },
      },
    })

    expect(mocks.addConversation).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Untitled',
      workspacePath: '/workspace',
    }))
    expect(mocks.addMessage).toHaveBeenCalledWith({
      convId: 'c1',
      role: 'user',
      status: 'success',
      content: [{ type: 'text', text: 'inspect project' }],
      images: [],
      attachments: [],
    })
    // startTask now takes (options, runtime) — check the first arg
    expect(mocks.startTask).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'c1',
        userMessageId: 'm1',
        prompt: 'inspect project',
        workspacePath: '/workspace',
      }),
      expect.objectContaining({
        onBeforeTurn: expect.any(Function),
        appendAgentLog: expect.any(Function),
      }),
    )
    expect(result).toEqual(expect.objectContaining({
      taskId: 't1',
      conversationId: 'c1',
      userMessageId: 'm1',
    }))
  })

  it('does not insert a user message when the conversation already has an active task', async () => {
    mocks.listActiveTasks.mockReturnValue([{ taskId: 't-existing' }])

    await expect(startAgentTurn({
      conversationId: 'c1',
      prompt: 'run it',
      chatSettings: {
        modelId: 'model-1',
        systemPrompt: '',
        temperature: 0.7,
        maxTokens: 1024,
        features: {
          onlineSearch: false,
          enableMCP: false,
        },
      },
    })).rejects.toThrow('AGENT_TASK_ALREADY_RUNNING')

    expect(mocks.addMessage).not.toHaveBeenCalled()
    expect(mocks.startTask).not.toHaveBeenCalled()
  })
})
