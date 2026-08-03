import { describe, expect, it, vi } from 'vitest'
import type { AppDataContext } from '../../data'
import { ChannelRuntime } from '../channelRuntime'

function createHarness() {
  const account = { id: 'a1', channelType: 'feishu' as const, displayName: '飞书', credentialRef: 'ref', defaultWorkspacePath: '/workspace', permissionMode: 'hybrid' as const, enabled: true, status: 'connected' as const, createdAt: 1, updatedAt: 1 }
  const conversation = { id: 'c1', workspacePath: '/workspace', title: 'Untitled', conversationInstructions: '', createdAt: 1, updatedAt: 1, settings: { modelId: 'm1', providerId: 'p1', temperature: 0.7, maxOutputTokens: 1024 }, sourceType: 'feishu' as const, sourceChannelAccountId: 'a1', sourceExternalChatId: 'chat-1' }
  const data = {
    channelAccountRepository: {
      getById: vi.fn(async () => account),
      updatePermissionMode: vi.fn(async (_id, permissionMode) => ({ ...account, permissionMode })),
    },
    channelPairingRepository: { get: vi.fn(async () => ({ id: 'pair', channelAccountId: 'a1', externalUserId: 'u1', externalDisplayName: '用户', status: 'authorized' as const, requestedAt: 1 })), upsert: vi.fn() },
    channelReceiptRepository: { get: vi.fn(async () => undefined), create: vi.fn(async () => ({ id: 'r1' })), updateStatus: vi.fn() },
    channelSessionRepository: { get: vi.fn(async () => ({ channelAccountId: 'a1', externalChatId: 'chat-1', activeConversationId: 'c1', currentWorkspacePath: '/workspace', createdAt: 1, updatedAt: 1 })), upsert: vi.fn() },
    workspaceService: { isWorkspaceAvailable: vi.fn(() => true), listWorkspaces: vi.fn(() => ({ workspaces: [{ path: '/workspace' }] })) },
    settingsRepository: { getGeneralSettings: vi.fn(async () => ({ assistantModelId: '', assistantProviderId: '' })) },
    conversationRepository: { getById: vi.fn(async () => conversation), create: vi.fn(), update: vi.fn() },
    messageRepository: { create: vi.fn(async () => ({ id: 'm-local' })), getById: vi.fn() },
  } as unknown as AppDataContext
  const startTurn = vi.fn(async () => ({ taskId: 't1', conversationId: 'c1', userMessageId: 'm1', conversation }))
  const updateConversation = vi.fn(input => data.conversationRepository.update(input))
  return { runtime: new ChannelRuntime({ data, turnService: { startTurn }, updateConversation }), data, startTurn, updateConversation }
}

describe('channelRuntime 入站行为', () => {
  it('重复 external message receipt 不重复启动 Agent', async () => {
    const { runtime, data, startTurn } = createHarness()
    await runtime.handleInbound({ channelAccountId: 'a1', channelType: 'feishu', externalUserId: 'u1', externalDisplayName: '用户', externalChatId: 'chat-1', externalMessageId: 'e1', text: '你好' })
    data.channelReceiptRepository.get = vi.fn(async () => ({ id: 'r1', channelAccountId: 'a1', externalChatId: 'chat-1', externalMessageId: 'e1', direction: 'inbound' as const, status: 'received' as const, createdAt: 1, updatedAt: 1 }))
    const result = await runtime.handleInbound({ channelAccountId: 'a1', channelType: 'feishu', externalUserId: 'u1', externalDisplayName: '用户', externalChatId: 'chat-1', externalMessageId: 'e1', text: '你好' })
    expect(result).toEqual({ kind: 'duplicate' })
    expect(startTurn).toHaveBeenCalledOnce()
    expect(startTurn).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'hybrid',
      turnSource: expect.objectContaining({ externalUserId: 'u1' }),
    }))
  })

  it('使用频道账号配置的权限模式启动 Turn', async () => {
    const { runtime, data, startTurn } = createHarness()
    data.channelAccountRepository.getById = vi.fn(async () => ({
      id: 'a1',
      channelType: 'feishu' as const,
      displayName: '飞书',
      credentialRef: 'ref',
      defaultWorkspacePath: '/workspace',
      permissionMode: 'full_managed' as const,
      enabled: true,
      status: 'connected' as const,
      createdAt: 1,
      updatedAt: 2,
    }))

    await runtime.handleInbound({
      channelAccountId: 'a1',
      channelType: 'feishu',
      externalUserId: 'u1',
      externalDisplayName: '用户',
      externalChatId: 'chat-1',
      externalMessageId: 'e-mode',
      text: '继续执行',
    })

    expect(startTurn).toHaveBeenCalledWith(expect.objectContaining({
      workspacePath: '/workspace',
      mode: 'full_managed',
    }))
  })

  it('未配对身份只创建 pending，不创建会话或启动 Turn', async () => {
    const { runtime, data, startTurn } = createHarness()
    data.channelPairingRepository.get = vi.fn(async () => undefined)
    const result = await runtime.handleInbound({ channelAccountId: 'a1', channelType: 'feishu', externalUserId: 'u2', externalDisplayName: '新用户', externalChatId: 'chat-2', externalMessageId: 'e2', text: '你好' })
    expect(result.kind).toBe('pairing-required')
    expect(data.channelPairingRepository.upsert).toHaveBeenCalledOnce()
    expect(startTurn).not.toHaveBeenCalled()
  })

  it('已有频道会话的模型失效时改用首个可用模型启动 Turn', async () => {
    const { data, updateConversation } = createHarness()
    data.conversationRepository.getById = vi.fn(async () => ({
      id: 'c1',
      workspacePath: '/workspace',
      title: 'Untitled',
      conversationInstructions: '',
      createdAt: 1,
      updatedAt: 1,
      settings: { modelId: '', providerId: '', temperature: 0.7, maxOutputTokens: 4096 },
      sourceType: 'feishu' as const,
      sourceChannelAccountId: 'a1',
      sourceExternalChatId: 'chat-1',
    }))
    const startTurn = vi.fn(async (options) => {
      if (options.modelConfig.modelId !== 'model-1' || options.modelConfig.providerId !== 'provider-1')
        throw new Error(`Model not found: ${options.modelConfig.providerId}/${options.modelConfig.modelId}`)
      return { taskId: 't1', conversationId: 'c1', userMessageId: 'm1', conversation: await data.conversationRepository.getById('c1') }
    })
    const runtime = new ChannelRuntime({
      data,
      turnService: { startTurn },
      updateConversation,
      listModels: () => [{
        modelId: 'model-1',
        providerId: 'provider-1',
        name: '可用模型',
        temperature: 0.3,
        maxOutputTokens: 8192,
      }],
    })

    await expect(runtime.handleInbound({
      channelAccountId: 'a1',
      channelType: 'feishu',
      externalUserId: 'u1',
      externalDisplayName: '用户',
      externalChatId: 'chat-1',
      externalMessageId: 'e-model',
      text: '你好',
    })).resolves.toMatchObject({ kind: 'turn' })
    expect(updateConversation).toHaveBeenCalledWith({
      id: 'c1',
      settings: {
        modelId: 'model-1',
        providerId: 'provider-1',
        temperature: 0.3,
        maxOutputTokens: 8192,
        reasoningEffort: undefined,
      },
    })
  })

  it('新频道会话不把助手模型当作默认模型', async () => {
    const { data, startTurn, updateConversation } = createHarness()
    const newConversation = {
      id: 'new-channel-conversation',
      workspacePath: '/workspace',
      title: 'Untitled',
      conversationInstructions: '',
      createdAt: 1,
      updatedAt: 1,
      settings: { modelId: 'channel-model', providerId: 'channel-provider', temperature: 0.4, maxOutputTokens: 8192 },
      sourceType: 'feishu' as const,
      sourceChannelAccountId: 'a1',
      sourceExternalChatId: 'chat-2',
    }
    data.channelSessionRepository.get = vi.fn(async () => undefined)
    data.channelSessionRepository.upsert = vi.fn(async input => input)
    data.settingsRepository.getGeneralSettings = vi.fn(async () => ({
      assistantModelId: 'assistant-model',
      assistantProviderId: 'assistant-provider',
      defaultModelId: '',
      defaultProviderId: '',
      autoGenerateTitle: false,
      reasoningEffort: undefined,
      proxySettings: { mode: 'none' as const, customProxyUrl: '' },
      appearance: { mode: 'system' as const, lightThemeId: 'default', darkThemeId: 'default' },
      developerTools: { agentObservabilityEnabled: false },
    }))
    data.conversationRepository.create = vi.fn(async () => newConversation)
    data.conversationRepository.getById = vi.fn(async () => newConversation)

    const runtime = new ChannelRuntime({
      data,
      turnService: { startTurn },
      updateConversation,
      listModels: () => [{
        modelId: 'channel-model',
        providerId: 'channel-provider',
        name: '频道模型',
        temperature: 0.4,
        maxOutputTokens: 8192,
      }],
    })

    await expect(runtime.handleInbound({
      channelAccountId: 'a1',
      channelType: 'feishu',
      externalUserId: 'u1',
      externalDisplayName: '用户',
      externalChatId: 'chat-2',
      externalMessageId: 'e-channel-model',
      text: '你好',
    })).resolves.toMatchObject({ kind: 'turn' })

    expect(data.conversationRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      settings: expect.objectContaining({ modelId: 'channel-model', providerId: 'channel-provider' }),
    }))
    expect(startTurn).toHaveBeenCalledWith(expect.objectContaining({
      modelConfig: expect.objectContaining({ modelId: 'channel-model', providerId: 'channel-provider' }),
    }))
  })

  it('/model 按用户可见名称同时保存 provider 和 model', async () => {
    const { data, updateConversation } = createHarness()
    const runtime = new ChannelRuntime({
      data,
      turnService: { startTurn: vi.fn() },
      updateConversation,
      listModels: () => [{
        modelId: 'model-2',
        providerId: 'provider-2',
        name: '模型二',
        providerName: '服务二',
        temperature: 0.2,
        maxOutputTokens: 16384,
      }],
    })

    await expect(runtime.handleInbound({
      channelAccountId: 'a1',
      channelType: 'feishu',
      externalUserId: 'u1',
      externalDisplayName: '用户',
      externalChatId: 'chat-1',
      externalMessageId: 'e-command',
      text: '/model 模型二',
    })).resolves.toEqual({
      kind: 'command',
      message: '已切换模型：服务二 / 模型二',
      conversationId: 'c1',
    })
    expect(updateConversation).toHaveBeenCalledWith({
      id: 'c1',
      settings: {
        modelId: 'model-2',
        providerId: 'provider-2',
        temperature: 0.2,
        maxOutputTokens: 16384,
        reasoningEffort: undefined,
      },
    })
  })

  it('/mode 使用用户可见名称持久化频道权限模式', async () => {
    const { runtime, data } = createHarness()

    await expect(runtime.handleInbound({
      channelAccountId: 'a1',
      channelType: 'feishu',
      externalUserId: 'u1',
      externalDisplayName: '用户',
      externalChatId: 'chat-1',
      externalMessageId: 'e-mode-command',
      text: '/mode 完全访问权限',
    })).resolves.toEqual({
      kind: 'command',
      message: '已切换权限模式：完全访问权限',
      conversationId: 'c1',
    })
    expect(data.channelAccountRepository.updatePermissionMode).toHaveBeenCalledWith('a1', 'full_managed')
  })

  it('/mode 无参数时返回包含当前选中项的权限模式卡片数据', async () => {
    const { runtime } = createHarness()

    await expect(runtime.handleInbound({
      channelAccountId: 'a1',
      channelType: 'feishu',
      externalUserId: 'u1',
      externalDisplayName: '用户',
      externalChatId: 'chat-1',
      externalMessageId: 'e-mode-card',
      text: '/mode',
    })).resolves.toEqual({
      kind: 'command',
      message: '请选择权限模式。',
      conversationId: 'c1',
      presentation: {
        kind: 'permission-mode-selection',
        modes: [
          { value: 'strict', label: '默认权限', selected: false },
          { value: 'hybrid', label: '自动审查', selected: true },
          { value: 'full_managed', label: '完全访问权限', selected: false },
        ],
      },
    })
  })

  it('/status 返回当前工作区、模型和权限模式', async () => {
    const { runtime } = createHarness()

    await expect(runtime.handleInbound({
      channelAccountId: 'a1',
      channelType: 'feishu',
      externalUserId: 'u1',
      externalDisplayName: '用户',
      externalChatId: 'chat-1',
      externalMessageId: 'e-status-context',
      text: '/status',
    })).resolves.toEqual({
      kind: 'command',
      message: '当前会话：c1\n工作区：/workspace\n当前模型：p1/m1\n权限模式：自动审查',
      conversationId: 'c1',
    })
  })

  it('/new 返回新会话的工作区、模型和权限模式', async () => {
    const { runtime, data } = createHarness()
    data.conversationRepository.create = vi.fn(async input => ({
      id: 'c2',
      ...input,
    }))
    data.channelSessionRepository.upsert = vi.fn(async input => input)

    await expect(runtime.handleInbound({
      channelAccountId: 'a1',
      channelType: 'feishu',
      externalUserId: 'u1',
      externalDisplayName: '用户',
      externalChatId: 'chat-1',
      externalMessageId: 'e-new-context',
      text: '/new',
    })).resolves.toEqual({
      kind: 'command',
      message: '已创建新会话\n工作区：/workspace\n当前模型：p1/m1\n权限模式：自动审查',
      conversationId: 'c2',
    })
  })

  it('重复控制命令由 inbound receipt 阻止再次执行', async () => {
    const { runtime, data } = createHarness()
    const event = {
      channelAccountId: 'a1',
      channelType: 'feishu' as const,
      externalUserId: 'u1',
      externalDisplayName: '用户',
      externalChatId: 'chat-1',
      externalMessageId: 'e-status',
      text: '/status',
    }

    await runtime.handleInbound(event)
    data.channelReceiptRepository.get = vi.fn(async () => ({
      id: 'r-status',
      channelAccountId: 'a1',
      externalChatId: 'chat-1',
      externalMessageId: 'e-status',
      direction: 'inbound' as const,
      status: 'received' as const,
      createdAt: 1,
      updatedAt: 1,
    }))

    await expect(runtime.handleInbound(event)).resolves.toEqual({ kind: 'duplicate' })
    expect(data.messageRepository.create).toHaveBeenCalledOnce()
  })
})
