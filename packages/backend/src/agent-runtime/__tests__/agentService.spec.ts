import type { AgentRuntime } from '../../agent-core'
import type { AppDataContext } from '../../data'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createAgentRuntimeController } from '../agentRuntimeController'

const startTask = vi.fn()

const runtime = {
  startTask,
  approvePendingAction: vi.fn(),
  rejectPendingAction: vi.fn(),
  cancelTask: vi.fn(),
  injectSteering: vi.fn(),
  listActiveTasks: vi.fn(() => []),
  getTask: vi.fn(),
} as unknown as AgentRuntime

const model = {
  id: 'model-1',
  model: 'mock-model',
  name: 'Mock Model',
  providerId: 'provider-1',
  contextLength: 128_000,
}
const provider = {
  id: 'provider-1',
  name: 'Provider',
  apiMode: 'openai' as const,
  apiKey: 'test-key',
  baseUrl: 'https://example.com',
  isOfficial: false,
  isEnabled: true,
  createdAt: 1,
  updatedAt: 1,
}
const conversation = {
  id: 'c1',
  title: 'Untitled',
  workspacePath: '/workspace',
  createdAt: 1,
  updatedAt: 1,
  settings: {
    modelId: 'model-1',
    providerId: 'provider-1',
    systemPrompt: 'custom',
    temperature: 0.2,
    maxTokens: 2048,
  },
}
const userMessage = {
  id: 'm1',
  convId: 'c1',
  createdAt: 2,
  role: 'user' as const,
  status: 'success' as const,
  content: [{ type: 'text' as const, text: 'inspect project' }],
}
const aiProvider = {
  streamModel: vi.fn(),
  complete: vi.fn(),
}
const aiProviderFactory = vi.fn(async () => aiProvider)

const appDataContext = {
  workspaceService: {} as unknown as AppDataContext['workspaceService'],
  modelCatalog: {
    resolveModel: vi.fn(async () => ({ model, provider })),
    getModel: vi.fn(async () => model),
    getProvider: vi.fn(async () => provider),
  },
  conversationRepository: {
    create: vi.fn(async () => conversation),
    getById: vi.fn(async () => conversation),
    delete: vi.fn(async () => true),
  },
  messageRepository: {
    create: vi.fn(async () => userMessage),
    delete: vi.fn(async () => true),
  },
  toolApprovalWhitelistRepository: {
    add: vi.fn(),
  },
  settingsRepository: {
    getGeneralSettings: vi.fn(async () => ({ assistantModelId: '', assistantProviderId: '', proxySettings: { mode: 'none', customProxyUrl: '' } })),
  },
} as unknown as AppDataContext

describe('createAgentRuntimeController 行为', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    startTask.mockResolvedValue({
      taskId: 't1',
      conversationId: 'c1',
      userMessageId: 'm1',
      conversation,
    })
  })

  it('新会话先完成验证，再创建 conversation 和 user message 后启动 runtime', async () => {
    const service = createAgentRuntimeController(runtime, appDataContext, { aiProviderFactory })

    await service.startTurn({
      prompt: 'inspect project',
      workspacePath: '/workspace',
      modelConfig: {
        modelId: 'model-1',
        providerId: 'provider-1',
        systemPrompt: 'custom',
        temperature: 0.2,
        maxTokens: 2048,
        features: {
          enableMCP: false,
        },
      },
    })

    expect(appDataContext.modelCatalog.resolveModel).toHaveBeenCalledWith({ providerId: 'provider-1', modelId: 'model-1' })
    expect(aiProviderFactory).toHaveBeenCalledWith({ model, provider })
    expect(appDataContext.conversationRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Untitled',
      workspacePath: '/workspace',
      settings: {
        modelId: 'model-1',
        providerId: 'provider-1',
        systemPrompt: 'custom',
        temperature: 0.2,
        maxTokens: 2048,
      },
    }))
    expect(appDataContext.messageRepository.create).toHaveBeenCalledWith({
      convId: 'c1',
      role: 'user',
      status: 'success',
      content: [{ type: 'text', text: 'inspect project' }],
      turnId: undefined,
    })
    expect(startTask).toHaveBeenCalledWith({
      prompt: 'inspect project',
      conversationId: 'c1',
      userMessageId: 'm1',
      model,
      provider,
      workspacePath: '/workspace',
      aiProvider,
      mode: 'hybrid',
      content: undefined,
      referencedFiles: undefined,
      selectedSkill: undefined,
      modelSettings: {
        systemPrompt: 'custom',
        temperature: 0.2,
        maxTokens: 2048,
      },
    })
  })

  it('保留显式传入的 turn 上下文字段', async () => {
    const service = createAgentRuntimeController(runtime, appDataContext, { aiProviderFactory })

    await service.startTurn({
      conversationId: 'c1',
      prompt: 'run it',
      workspacePath: '/explicit-workspace',
      mode: 'strict',
      referencedFiles: ['src/main.ts'],
      selectedSkill: 'review',
      content: [
        { type: 'text', text: 'run it' },
        { type: 'image-block', source: { type: 'file_id', file_id: 'img-1' }, name: 'a.png', media_type: 'image/png', size: 1 },
        { type: 'document', source: { type: 'file_id', file_id: 'file-1' }, name: 'a.txt', media_type: 'text/plain', size: 1 },
      ],
      modelConfig: {
        modelId: 'model-1',
        providerId: 'provider-1',
        systemPrompt: 'custom',
        temperature: 0.2,
        maxTokens: 2048,
        features: {
          enableMCP: false,
        },
      },
    })

    expect(startTask).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'c1',
      userMessageId: 'm1',
      workspacePath: '/explicit-workspace',
      mode: 'strict',
      referencedFiles: ['src/main.ts'],
      selectedSkill: 'review',
      content: [
        { type: 'text', text: 'run it' },
        { type: 'image-block', source: { type: 'file_id', file_id: 'img-1' }, name: 'a.png', media_type: 'image/png', size: 1 },
        { type: 'document', source: { type: 'file_id', file_id: 'file-1' }, name: 'a.txt', media_type: 'text/plain', size: 1 },
      ],
    }))
    expect(appDataContext.conversationRepository.create).not.toHaveBeenCalled()
    expect(appDataContext.conversationRepository.getById).toHaveBeenCalledWith('c1')
  })

  it('aPI Key 验证失败时不创建 conversation 或 user message', async () => {
    aiProviderFactory.mockRejectedValueOnce(new Error('missing api key'))
    const service = createAgentRuntimeController(runtime, appDataContext, { aiProviderFactory })

    await expect(service.startTurn({
      prompt: 'inspect project',
      workspacePath: '/workspace',
      modelConfig: {
        modelId: 'model-1',
        providerId: 'provider-1',
        systemPrompt: 'custom',
        temperature: 0.2,
        maxTokens: 2048,
        features: {
          enableMCP: false,
        },
      },
    })).rejects.toThrow('missing api key')

    expect(appDataContext.conversationRepository.create).not.toHaveBeenCalled()
    expect(appDataContext.messageRepository.create).not.toHaveBeenCalled()
    expect(startTask).not.toHaveBeenCalled()
  })

  it('成功启动新会话后异步初始化标题并发出 conversation 更新', async () => {
    const titledConversation = { ...conversation, title: '项目检查' }
    const titleGenerator = {
      updateTitle: vi.fn(async () => titledConversation),
    }
    const emitConversationUpdated = vi.fn()
    const service = createAgentRuntimeController(runtime, appDataContext, {
      aiProviderFactory,
      titleGenerator,
      emitConversationUpdated,
    })

    await service.startTurn({
      prompt: 'inspect project',
      workspacePath: '/workspace',
      modelConfig: {
        modelId: 'model-1',
        providerId: 'provider-1',
        systemPrompt: 'custom',
        temperature: 0.2,
        maxTokens: 2048,
        features: {
          enableMCP: false,
        },
      },
    })
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(titleGenerator.updateTitle).toHaveBeenCalledWith('c1', { providerId: 'provider-1', modelId: 'model-1' })
    expect(emitConversationUpdated).toHaveBeenCalledWith(titledConversation)
  })

  it('初始化标题优先使用设置页面配置的助手模型', async () => {
    vi.mocked(appDataContext.settingsRepository.getGeneralSettings).mockResolvedValueOnce({
      assistantModelId: 'assistant-model-9',
      assistantProviderId: 'provider-1',
      proxySettings: { mode: 'none', customProxyUrl: '' },
    })
    const titledConversation = { ...conversation, title: '项目检查' }
    const titleGenerator = {
      updateTitle: vi.fn(async () => titledConversation),
    }
    const emitConversationUpdated = vi.fn()
    const service = createAgentRuntimeController(runtime, appDataContext, {
      aiProviderFactory,
      titleGenerator,
      emitConversationUpdated,
    })

    await service.startTurn({
      prompt: 'inspect project',
      workspacePath: '/workspace',
      modelConfig: {
        modelId: 'model-1',
        providerId: 'provider-1',
        systemPrompt: 'custom',
        temperature: 0.2,
        maxTokens: 2048,
        features: {
          enableMCP: false,
        },
      },
    })
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(appDataContext.settingsRepository.getGeneralSettings).toHaveBeenCalled()
    expect(titleGenerator.updateTitle).toHaveBeenCalledWith('c1', { providerId: 'provider-1', modelId: 'assistant-model-9' })
  })

  it('读取助手模型设置失败时回退到当前对话模型生成标题', async () => {
    vi.mocked(appDataContext.settingsRepository.getGeneralSettings).mockRejectedValueOnce(new Error('settings read failed'))
    const titledConversation = { ...conversation, title: '项目检查' }
    const titleGenerator = {
      updateTitle: vi.fn(async () => titledConversation),
    }
    const emitConversationUpdated = vi.fn()
    const service = createAgentRuntimeController(runtime, appDataContext, {
      aiProviderFactory,
      titleGenerator,
      emitConversationUpdated,
    })

    await service.startTurn({
      prompt: 'inspect project',
      workspacePath: '/workspace',
      modelConfig: {
        modelId: 'model-1',
        providerId: 'provider-1',
        systemPrompt: 'custom',
        temperature: 0.2,
        maxTokens: 2048,
        features: {
          enableMCP: false,
        },
      },
    })
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(titleGenerator.updateTitle).toHaveBeenCalledWith('c1', { providerId: 'provider-1', modelId: 'model-1' })
    expect(emitConversationUpdated).toHaveBeenCalledWith(titledConversation)
  })

  it('startTurn 未传 workspacePath 时抛错,不再兜底 getCurrentWorkspacePath() 或 process.cwd()', async () => {
    const service = createAgentRuntimeController(runtime, appDataContext, { aiProviderFactory })

    await expect(service.startTurn({
      prompt: 'inspect',
      modelConfig: {
        modelId: 'model-1',
        providerId: 'provider-1',
        systemPrompt: 'custom',
        temperature: 0.2,
        maxTokens: 2048,
        features: { enableMCP: false },
      },
    } as any)).rejects.toThrow('workspacePath is required')
  })

  it('记住审批时写入工具白名单后再批准 pending action', () => {
    vi.mocked(runtime.getTask).mockReturnValue({
      taskId: 't1',
      conversationId: 'c1',
      userMessageId: 'm1',
      workspacePath: '/workspace',
      mode: 'strict',
      status: 'awaiting_approval',
      createdAt: 1,
      updatedAt: 1,
      logPath: '',
      prompt: 'inspect',
      pendingAction: {
        actionId: 'a1',
        toolName: 'write_file',
        operationType: 'write',
        scope: 'workspace',
        inputPreview: '{"path":"src/index.ts"}',
        createdAt: 1,
        whitelistPattern: './src/**',
      },
    })

    const service = createAgentRuntimeController(runtime, appDataContext)
    const result = service.approvePendingActionWithWhitelist({
      taskId: 't1',
      actionId: 'a1',
      remember: true,
      workspacePath: '/workspace',
    })

    expect(result).toBeNull()
    expect(appDataContext.toolApprovalWhitelistRepository.add).toHaveBeenCalledWith({
      toolName: 'write_file',
      toolScope: 'workspace',
      pattern: './src/**',
      workspacePath: '/workspace',
    })
    expect(runtime.approvePendingAction).toHaveBeenCalledWith({
      taskId: 't1',
      actionId: 'a1',
      remember: true,
      workspacePath: '/workspace',
    })
  })
})
