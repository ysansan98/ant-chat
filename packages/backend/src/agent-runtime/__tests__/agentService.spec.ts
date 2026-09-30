import type { AgentRuntime } from '../../agent-core'
import type { AppDataContext } from '../../data'
import type { PendingMessageService } from '../pendingMessageService'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createConversationLifecycle } from '../../conversations/conversationLifecycle'
import { createAgentTurnService } from '../agentTurnService'

const startTask = vi.fn()

const runtime = {
  startSessionTask: startTask,
  approvePendingAction: vi.fn(),
  rejectPendingAction: vi.fn(),
  cancelTask: vi.fn(),
  injectSteering: vi.fn(),
  listActiveTasks: vi.fn(() => []),
  getTask: vi.fn(),
  closeConversation: vi.fn(),
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
  conversationInstructions: '',
  settings: {
    modelId: 'model-1',
    providerId: 'provider-1',
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
    update: vi.fn(async input => ({ ...conversation, ...input })),
  },
  messageRepository: {
    create: vi.fn(async () => userMessage),
    getById: vi.fn(async () => userMessage),
    delete: vi.fn(async () => true),
  },
  settingsRepository: {
    getGeneralSettings: vi.fn(async () => ({ assistantModelId: '', assistantProviderId: '', defaultModelId: '', defaultProviderId: '', autoGenerateTitle: true, proxySettings: { mode: 'none', customProxyUrl: '' } })),
  },
} as unknown as AppDataContext

const pendingMessages = {
  listRecords: vi.fn(async () => []),
  snapshot: vi.fn(async (conversationId: string) => ({ conversationId, revision: 0, messages: [] })),
  enqueue: vi.fn(async (input: { conversationId: string }) => ({ conversationId: input.conversationId, revision: 1, messages: [] })),
  edit: vi.fn(async (conversationId: string) => ({ conversationId, revision: 1, messages: [] })),
  remove: vi.fn(async (conversationId: string) => ({ conversationId, revision: 1, messages: [] })),
  steer: vi.fn(),
} as unknown as PendingMessageService

const runningTask = {
  taskId: 'task-running',
  conversationId: 'c1',
  userMessageId: 'm0',
  workspacePath: '/workspace',
  mode: 'hybrid' as const,
  status: 'running' as const,
  createdAt: 1,
  updatedAt: 2,
  prompt: 'running',
}

function mockRunningTasksOnce(tasks: unknown[] = [runningTask]) {
  (runtime.listActiveTasks as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(tasks)
}

function createService(
  deps: Omit<Parameters<typeof createAgentTurnService>[0], 'runtime' | 'appDataContext' | 'conversationLifecycle' | 'pendingMessages'> & {
    onConversationUpdated?: (value: typeof conversation) => void
  } = {},
) {
  const { onConversationUpdated, ...serviceDeps } = deps
  const conversationLifecycle = createConversationLifecycle({
    data: appDataContext,
    events: {
      emit(name, event) {
        if (name === 'conversation:updated' && 'conversation' in event) {
          onConversationUpdated?.(event.conversation as typeof conversation)
        }
      },
    },
    runtime,
  })
  return createAgentTurnService({ runtime, appDataContext, conversationLifecycle, pendingMessages, ...serviceDeps })
}

describe('createAgentTurnService 行为', () => {
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
    const service = createService({ aiProviderFactory })

    await service.startTurn({
      messageContent: [{ type: 'text', text: 'inspect project' }],
      workspacePath: '/workspace',
      modelConfig: {
        modelId: 'model-1',
        providerId: 'provider-1',
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
      messageContent: [{ type: 'text', text: 'inspect project' }],
      conversationId: 'c1',
      userMessageId: 'm1',
      model,
      provider,
      workspacePath: '/workspace',
      aiProvider,
      mode: 'hybrid',
      modelSettings: {
        reasoningEffort: undefined,
      },
    })
  })

  it('运行时拒绝重复任务时回滚刚创建的用户消息', async () => {
    startTask.mockRejectedValueOnce(new Error('AGENT_TASK_ALREADY_RUNNING'))
    const emitMessageUpdated = vi.fn()
    const service = createService({ aiProviderFactory, emitMessageUpdated })

    await expect(service.startTurn({
      conversationId: 'c1',
      messageContent: [{ type: 'text', text: 'inspect project' }],
      workspacePath: '/workspace',
      modelConfig: {
        modelId: 'model-1',
        providerId: 'provider-1',
      },
    })).rejects.toThrow('AGENT_TASK_ALREADY_RUNNING')

    // 启动前会先探测活跃任务（用于排队判定）；竞态下仍按启动失败回滚消息
    expect(runtime.listActiveTasks).toHaveBeenCalledWith('c1')
    expect(pendingMessages.enqueue).not.toHaveBeenCalled()
    expect(appDataContext.messageRepository.delete).toHaveBeenCalledWith('m1')
    expect(emitMessageUpdated).not.toHaveBeenCalled()
  })

  it('新会话启动失败时回滚 conversation 且不发布 ghost event', async () => {
    startTask.mockRejectedValueOnce(new Error('runtime start failed'))
    const emitConversationUpdated = vi.fn()
    const service = createService({ aiProviderFactory, onConversationUpdated: emitConversationUpdated })

    await expect(service.startTurn({
      messageContent: [{ type: 'text', text: 'inspect project' }],
      workspacePath: '/workspace',
      modelConfig: {
        modelId: 'model-1',
        providerId: 'provider-1',
      },
    })).rejects.toThrow('runtime start failed')

    expect(appDataContext.conversationRepository.delete).toHaveBeenCalledWith('c1')
    expect(emitConversationUpdated).not.toHaveBeenCalled()
  })

  it('保留显式传入的 turn 上下文字段', async () => {
    const service = createService({ aiProviderFactory })

    await service.startTurn({
      conversationId: 'c1',
      messageContent: [
        { type: 'text', text: 'run it' },
        { type: 'image', source: { type: 'file_id', file_id: 'img-1' }, name: 'a.png', mimeType: 'image/png', size: 1 },
        { type: 'document', source: { type: 'file_id', file_id: 'file-1' }, name: 'a.txt', media_type: 'text/plain', size: 1 },
      ],
      workspacePath: '/explicit-workspace',
      mode: 'strict',
      modelConfig: {
        modelId: 'model-1',
        providerId: 'provider-1',
      },
    })

    expect(startTask).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'c1',
      userMessageId: 'm1',
      workspacePath: '/explicit-workspace',
      mode: 'strict',
      messageContent: [
        { type: 'text', text: 'run it' },
        { type: 'image', source: { type: 'file_id', file_id: 'img-1' }, name: 'a.png', mimeType: 'image/png', size: 1 },
        { type: 'document', source: { type: 'file_id', file_id: 'file-1' }, name: 'a.txt', media_type: 'text/plain', size: 1 },
      ],
    }))
    expect(appDataContext.conversationRepository.create).not.toHaveBeenCalled()
    expect(appDataContext.conversationRepository.getById).toHaveBeenCalledWith('c1')
  })

  it('aPI Key 验证失败时不创建 conversation 或 user message', async () => {
    aiProviderFactory.mockRejectedValueOnce(new Error('missing api key'))
    const service = createService({ aiProviderFactory })

    await expect(service.startTurn({
      messageContent: [{ type: 'text', text: 'inspect project' }],
      workspacePath: '/workspace',
      modelConfig: {
        modelId: 'model-1',
        providerId: 'provider-1',
      },
    })).rejects.toThrow('missing api key')

    expect(appDataContext.conversationRepository.create).not.toHaveBeenCalled()
    expect(appDataContext.messageRepository.create).not.toHaveBeenCalled()
    expect(startTask).not.toHaveBeenCalled()
  })

  it('成功启动新会话后由 titleGenerator 异步初始化标题，不重复发布更新事件', async () => {
    const titledConversation = { ...conversation, title: '项目检查' }
    const titleGenerator = {
      updateTitle: vi.fn(async () => titledConversation),
    }
    const emitConversationUpdated = vi.fn()
    const service = createService({
      aiProviderFactory,
      titleGenerator,
      onConversationUpdated: emitConversationUpdated,
    })

    await service.startTurn({
      messageContent: [{ type: 'text', text: 'inspect project' }],
      workspacePath: '/workspace',
      modelConfig: {
        modelId: 'model-1',
        providerId: 'provider-1',
      },
    })
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(titleGenerator.updateTitle).toHaveBeenCalledWith('c1', { providerId: 'provider-1', modelId: 'model-1' })
    expect(emitConversationUpdated).toHaveBeenCalledOnce()
    expect(emitConversationUpdated).toHaveBeenCalledWith(conversation)
  })

  it('初始化标题优先使用设置页面配置的助手模型', async () => {
    vi.mocked(appDataContext.settingsRepository.getGeneralSettings).mockResolvedValueOnce({
      assistantModelId: 'assistant-model-9',
      assistantProviderId: 'provider-1',
      visionModelId: '',
      visionProviderId: '',
      imageGenModelId: '',
      imageGenProviderId: '',
      defaultModelId: '',
      defaultProviderId: '',
      autoGenerateTitle: true,
      developerTools: { agentObservabilityEnabled: false },
      proxySettings: { mode: 'none', customProxyUrl: '' },
      appearance: { mode: 'system', lightThemeId: 'default', darkThemeId: 'default' },
    })
    const titledConversation = { ...conversation, title: '项目检查' }
    const titleGenerator = {
      updateTitle: vi.fn(async () => titledConversation),
    }
    const emitConversationUpdated = vi.fn()
    const service = createService({
      aiProviderFactory,
      titleGenerator,
      onConversationUpdated: emitConversationUpdated,
    })

    await service.startTurn({
      messageContent: [{ type: 'text', text: 'inspect project' }],
      workspacePath: '/workspace',
      modelConfig: {
        modelId: 'model-1',
        providerId: 'provider-1',
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
    const service = createService({
      aiProviderFactory,
      titleGenerator,
      onConversationUpdated: emitConversationUpdated,
    })

    await service.startTurn({
      messageContent: [{ type: 'text', text: 'inspect project' }],
      workspacePath: '/workspace',
      modelConfig: {
        modelId: 'model-1',
        providerId: 'provider-1',
      },
    })
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(titleGenerator.updateTitle).toHaveBeenCalledWith('c1', { providerId: 'provider-1', modelId: 'model-1' })
    expect(emitConversationUpdated).toHaveBeenCalledOnce()
    expect(emitConversationUpdated).toHaveBeenCalledWith(conversation)
  })

  it('startTurn 未传 workspacePath 时抛错,不再兜底 getCurrentWorkspacePath() 或 process.cwd()', async () => {
    const service = createService({ aiProviderFactory })

    await expect(service.startTurn({
      messageContent: [{ type: 'text', text: 'inspect' }],
      modelConfig: {
        modelId: 'model-1',
        providerId: 'provider-1',
      },
    } as any)).rejects.toThrow('workspacePath is required')
  })

  it('新 conversation 创建后 conversationInstructions 等于启动时的指令', async () => {
    const service = createService({ aiProviderFactory })

    await service.startTurn({
      messageContent: [{ type: 'text', text: 'inspect project' }],
      workspacePath: '/workspace',
      conversationInstructions: '请用中文回答，保持简洁',
      modelConfig: {
        modelId: 'model-1',
        providerId: 'provider-1',
      },
    })

    expect(appDataContext.conversationRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationInstructions: '请用中文回答，保持简洁',
      }),
    )
  })

  it('settings 不再包含 systemPrompt', async () => {
    const service = createService({ aiProviderFactory })

    await service.startTurn({
      messageContent: [{ type: 'text', text: 'inspect project' }],
      workspacePath: '/workspace',
      modelConfig: {
        modelId: 'model-1',
        providerId: 'provider-1',
      },
    })

    expect(appDataContext.conversationRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.not.objectContaining({ systemPrompt: expect.anything() }),
      }),
    )
  })

  it('reasoningEffort 被持久化并传入 runtime', async () => {
    const service = createService({ aiProviderFactory })

    await service.startTurn({
      messageContent: [{ type: 'text', text: 'inspect project' }],
      workspacePath: '/workspace',
      modelConfig: {
        modelId: 'model-1',
        providerId: 'provider-1',
        reasoningEffort: 'high',
      },
    })

    expect(appDataContext.conversationRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({
          reasoningEffort: 'high',
        }),
      }),
    )
    expect(startTask).toHaveBeenCalledWith(
      expect.objectContaining({
        modelSettings: expect.objectContaining({
          reasoningEffort: 'high',
        }),
      }),
    )
  })

  it('后续 turn 使用持久化 reasoningEffort，不接受请求值覆盖', async () => {
    vi.mocked(appDataContext.conversationRepository.getById).mockResolvedValueOnce({
      ...conversation,
      settings: {
        ...conversation.settings,
        reasoningEffort: 'high',
      },
    })
    const service = createService({ aiProviderFactory })

    await service.startTurn({
      conversationId: 'c1',
      messageContent: [{ type: 'text', text: 'inspect project again' }],
      workspacePath: '/workspace',
      modelConfig: {
        modelId: 'model-1',
        providerId: 'provider-1',
        reasoningEffort: 'low',
      },
    })

    expect(startTask).toHaveBeenCalledWith(expect.objectContaining({
      modelSettings: expect.objectContaining({ reasoningEffort: 'high' }),
    }))
  })

  it('未传 reasoningEffort 时保持 undefined 不注入默认档位', async () => {
    const service = createService({ aiProviderFactory })

    await service.startTurn({
      messageContent: [{ type: 'text', text: 'inspect project' }],
      workspacePath: '/workspace',
      modelConfig: {
        modelId: 'model-1',
        providerId: 'provider-1',
      },
    })

    expect(startTask).toHaveBeenCalledWith(
      expect.objectContaining({
        modelSettings: expect.not.objectContaining({
          reasoningEffort: expect.anything(),
        }),
      }),
    )
  })

  it('未传 compaction 时不要求该字段', async () => {
    const service = createService({ aiProviderFactory })

    await service.startTurn({
      messageContent: [{ type: 'text', text: 'inspect project' }],
      workspacePath: '/workspace',
      modelConfig: {
        modelId: 'model-1',
        providerId: 'provider-1',
      },
    })

    expect(appDataContext.conversationRepository.create).toHaveBeenCalled()
    // settings 中不出现 compaction（不在 start-turn 时补默认值）
    const createCall = vi.mocked(appDataContext.conversationRepository.create).mock.calls[0][0]
    const settings = (createCall as any).settings
    expect(settings).not.toHaveProperty('compaction')
  })

  it('多 text block 时持久化内容与传给 runtime 的规范化内容一致，无第二份 prompt 覆盖', async () => {
    const service = createService({ aiProviderFactory })

    await service.startTurn({
      conversationId: 'c1',
      messageContent: [
        { type: 'text', text: 'first block' },
        { type: 'text', text: 'second block' },
        { type: 'image', source: { type: 'file_id', file_id: 'img-1' }, name: 'a.png', mimeType: 'image/png', size: 1 },
      ],
      workspacePath: '/workspace',
      modelConfig: {
        modelId: 'model-1',
        providerId: 'provider-1',
      },
    })

    // 持久化内容 = messageContent（原样保存）
    expect(appDataContext.messageRepository.create).toHaveBeenCalledWith({
      convId: 'c1',
      role: 'user',
      status: 'success',
      content: [
        { type: 'text', text: 'first block' },
        { type: 'text', text: 'second block' },
        { type: 'image', source: { type: 'file_id', file_id: 'img-1' }, name: 'a.png', mimeType: 'image/png', size: 1 },
      ],
      turnId: undefined,
    })
    // canonical text = 所有 text block 拼接的 trim
    expect(startTask).toHaveBeenCalledWith(
      expect.objectContaining({
        messageContent: [
          { type: 'text', text: 'first block' },
          { type: 'text', text: 'second block' },
          { type: 'image', source: { type: 'file_id', file_id: 'img-1' }, name: 'a.png', mimeType: 'image/png', size: 1 },
        ],
      }),
    )
    // userText 仅从 messageContent 提取并用于标题和校验，不进入 startTask payload。
    const callArg = startTask.mock.calls[0]?.[0] as { workspacePath: string }
    expect(callArg.workspacePath).toBe('/workspace')
  })

  it('会话运行中提交时进入待处理队列而不启动任务', async () => {
    mockRunningTasksOnce()
    const service = createService({ aiProviderFactory })

    const result = await service.startTurn({
      conversationId: 'c1',
      messageContent: [{ type: 'text', text: '调整实现' }],
      workspacePath: '/workspace',
      mode: 'strict',
      modelConfig: {
        modelId: 'model-1',
        providerId: 'provider-1',
      },
    })

    expect(result.kind).toBe('queued')
    expect(startTask).not.toHaveBeenCalled()
    expect(pendingMessages.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'c1',
      text: '调整实现',
      source: 'sender',
      mode: 'strict',
    }))
  })

  it('频道消息运行中入队时先持久化 user message 供接力复用', async () => {
    mockRunningTasksOnce()
    const emitMessageUpdated = vi.fn()
    const service = createService({ aiProviderFactory, emitMessageUpdated })

    const result = await service.startTurn({
      conversationId: 'c1',
      messageContent: [{ type: 'text', text: '频道消息' }],
      turnSource: {
        type: 'channel',
        channelType: 'feishu',
        channelAccountId: 'a1',
        externalUserId: 'u1',
        externalChatId: 'chat-1',
        externalMessageId: 'e1',
      },
      workspacePath: '/workspace',
      modelConfig: {
        modelId: 'model-1',
        providerId: 'provider-1',
      },
    })

    expect(result).toMatchObject({ kind: 'queued', userMessageId: 'm1' })
    expect(startTask).not.toHaveBeenCalled()
    expect(appDataContext.messageRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      convId: 'c1',
      role: 'user',
      originType: 'feishu',
      originExternalChatId: 'chat-1',
    }))
    expect(emitMessageUpdated).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1' }))
    expect(pendingMessages.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      source: 'channel',
      userMessageId: 'm1',
    }))
  })

  it('接力：无活跃任务时把队首消息作为新一轮发出并出队', async () => {
    const record = {
      id: 'p1',
      conversationId: 'c1',
      text: '接力内容',
      source: 'sender' as const,
      mode: 'strict' as const,
      userMessageId: 'm1',
      createdAt: 1,
    }
    vi.mocked(pendingMessages.listRecords).mockResolvedValueOnce([record])
    const service = createService({ aiProviderFactory })

    await service.relayPendingMessages('c1')

    expect(startTask).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'c1',
      userMessageId: 'm1',
      mode: 'strict',
      workspacePath: '/workspace',
    }))
    expect(pendingMessages.remove).toHaveBeenCalledWith('c1', 'p1')
  })

  it('接力：启动失败时保留队列项，不重试不丢失', async () => {
    vi.mocked(pendingMessages.listRecords).mockResolvedValueOnce([{
      id: 'p1',
      conversationId: 'c1',
      text: '接力内容',
      source: 'sender' as const,
      createdAt: 1,
    }])
    startTask.mockRejectedValueOnce(new Error('Model not found'))
    const service = createService({ aiProviderFactory })

    await service.relayPendingMessages('c1')

    expect(startTask).toHaveBeenCalledTimes(1)
    expect(pendingMessages.remove).not.toHaveBeenCalled()
  })

  it('接力：会话仍有活跃任务或队列为空时直接跳过', async () => {
    mockRunningTasksOnce()
    const service = createService({ aiProviderFactory })

    await service.relayPendingMessages('c1')
    expect(pendingMessages.listRecords).not.toHaveBeenCalled()

    vi.mocked(pendingMessages.listRecords).mockResolvedValueOnce([])
    await service.relayPendingMessages('c1')
    expect(startTask).not.toHaveBeenCalled()
  })
})
