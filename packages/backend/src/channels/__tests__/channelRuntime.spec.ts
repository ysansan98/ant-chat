import { describe, expect, it, vi } from 'vitest'
import type { IMessage } from '@ant-chat/shared'
import type { AppDataContext } from '../../data'
import { ChannelRuntime } from '../channelRuntime'

function createHarness() {
  const account = { id: 'a1', channelType: 'feishu' as const, displayName: '飞书', credentialRef: 'ref', defaultWorkspacePath: '/workspace', permissionMode: 'hybrid' as const, enabled: true, status: 'connected' as const, createdAt: 1, updatedAt: 1 }
  const conversation = { id: 'c1', workspacePath: '/workspace', title: 'Untitled', conversationInstructions: '', createdAt: 1, updatedAt: 1, settings: { modelId: 'm1', providerId: 'p1' }, sourceType: 'feishu' as const, sourceChannelAccountId: 'a1', sourceExternalChatId: 'chat-1' }
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
  const injectSteering = vi.fn(async (_conversationId: string, _text: string): Promise<IMessage | null> => null)
  return { runtime: new ChannelRuntime({ data, turnService: { startTurn }, updateConversation, injectSteering }), data, startTurn, updateConversation, injectSteering }
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

  it('微信 owner 身份首次消息自动授权并启动 Turn', async () => {
    const { runtime, data, startTurn } = createHarness()
    data.channelAccountRepository.getById = vi.fn(async () => ({
      id: 'a1',
      channelType: 'weixin' as const,
      displayName: '微信',
      credentialRef: 'ref',
      ownerUserId: 'owner-1',
      defaultWorkspacePath: '/workspace',
      permissionMode: 'hybrid' as const,
      enabled: true,
      status: 'connected' as const,
      createdAt: 1,
      updatedAt: 1,
    }))
    data.channelPairingRepository.get = vi.fn(async () => undefined)
    data.channelPairingRepository.upsert = vi.fn(async input => ({ ...input, id: input.id }))

    await expect(runtime.handleInbound({
      channelAccountId: 'a1',
      channelType: 'weixin',
      externalUserId: 'owner-1',
      externalDisplayName: '本人',
      externalChatId: 'owner-1',
      externalMessageId: 'e-owner',
      text: '你好',
    })).resolves.toMatchObject({ kind: 'turn' })
    expect(data.channelPairingRepository.upsert).toHaveBeenCalledWith(expect.objectContaining({
      externalUserId: 'owner-1',
      status: 'authorized',
    }))
    expect(startTurn).toHaveBeenCalledOnce()
  })

  it('微信非 owner 身份仍回退配对流程', async () => {
    const { runtime, data, startTurn } = createHarness()
    data.channelAccountRepository.getById = vi.fn(async () => ({
      id: 'a1',
      channelType: 'weixin' as const,
      displayName: '微信',
      credentialRef: 'ref',
      ownerUserId: 'owner-1',
      defaultWorkspacePath: '/workspace',
      permissionMode: 'hybrid' as const,
      enabled: true,
      status: 'connected' as const,
      createdAt: 1,
      updatedAt: 1,
    }))
    data.channelPairingRepository.get = vi.fn(async () => undefined)

    const result = await runtime.handleInbound({
      channelAccountId: 'a1',
      channelType: 'weixin',
      externalUserId: 'other-1',
      externalDisplayName: '其他人',
      externalChatId: 'other-1',
      externalMessageId: 'e-other',
      text: '你好',
    })
    expect(result.kind).toBe('pairing-required')
    expect(data.channelPairingRepository.upsert).toHaveBeenCalledWith(expect.objectContaining({
      externalUserId: 'other-1',
      status: 'pending',
    }))
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
      settings: { modelId: '', providerId: '' },
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
      }],
      injectSteering: vi.fn(async () => null),
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
      settings: { modelId: 'channel-model', providerId: 'channel-provider' },
      sourceType: 'feishu' as const,
      sourceChannelAccountId: 'a1',
      sourceExternalChatId: 'chat-2',
    }
    data.channelSessionRepository.get = vi.fn(async () => undefined)
    data.channelSessionRepository.upsert = vi.fn(async input => input)
    data.settingsRepository.getGeneralSettings = vi.fn(async () => ({
      assistantModelId: 'assistant-model',
      assistantProviderId: 'assistant-provider',
      visionModelId: '',
      visionProviderId: '',
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
      }],
      injectSteering: vi.fn(async () => null),
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
      }],
      injectSteering: vi.fn(async () => null),
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
        reasoningEffort: undefined,
      },
    })
  })

  it('/models 返回带序号的模型列表，序号与选择卡片顺序一致', async () => {
    const { data, updateConversation } = createHarness()
    const models = [
      { modelId: 'model-1', providerId: 'provider-1', name: '模型一', providerName: '服务一' },
      { modelId: 'model-2', providerId: 'provider-2', name: '模型二', providerName: '服务二' },
    ]
    const runtime = new ChannelRuntime({
      data,
      turnService: { startTurn: vi.fn() },
      updateConversation,
      listModels: () => models,
      injectSteering: vi.fn(async () => null),
    })

    await expect(runtime.handleInbound({
      channelAccountId: 'a1',
      channelType: 'feishu',
      externalUserId: 'u1',
      externalDisplayName: '用户',
      externalChatId: 'chat-1',
      externalMessageId: 'e-models-list',
      text: '/models',
    })).resolves.toEqual({
      kind: 'command',
      message: '1. 服务一 / 模型一\n2. 服务二 / 模型二',
      conversationId: 'c1',
      presentation: {
        kind: 'model-selection',
        models: [
          { providerId: 'provider-1', modelId: 'model-1', label: '1. 服务一 / 模型一', selected: false },
          { providerId: 'provider-2', modelId: 'model-2', label: '2. 服务二 / 模型二', selected: false },
        ],
      },
    })
  })

  it('/model 按 /models 序号切换模型', async () => {
    const { data, updateConversation } = createHarness()
    const runtime = new ChannelRuntime({
      data,
      turnService: { startTurn: vi.fn() },
      updateConversation,
      listModels: () => [
        { modelId: 'model-1', providerId: 'provider-1', name: '模型一', providerName: '服务一' },
        { modelId: 'model-2', providerId: 'provider-2', name: '模型二', providerName: '服务二' },
      ],
      injectSteering: vi.fn(async () => null),
    })

    await expect(runtime.handleInbound({
      channelAccountId: 'a1',
      channelType: 'feishu',
      externalUserId: 'u1',
      externalDisplayName: '用户',
      externalChatId: 'chat-1',
      externalMessageId: 'e-model-index',
      text: '/model 2',
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
        reasoningEffort: undefined,
      },
    })
  })

  it('/model 无效序号直接报错，不按名称回退', async () => {
    const { data, updateConversation } = createHarness()
    const runtime = new ChannelRuntime({
      data,
      turnService: { startTurn: vi.fn() },
      updateConversation,
      listModels: () => [
        { modelId: 'model-1', providerId: 'provider-1', name: '模型一', providerName: '服务一' },
      ],
      injectSteering: vi.fn(async () => null),
    })

    await expect(runtime.handleInbound({
      channelAccountId: 'a1',
      channelType: 'feishu',
      externalUserId: 'u1',
      externalDisplayName: '用户',
      externalChatId: 'chat-1',
      externalMessageId: 'e-model-invalid-index',
      text: '/model 9',
    })).resolves.toEqual({
      kind: 'command',
      message: '模型序号无效，请发送 /models 查看列表。',
      conversationId: 'c1',
    })
    expect(updateConversation).not.toHaveBeenCalled()
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

  it('/mode 按列表序号切换权限模式', async () => {
    const { runtime, data } = createHarness()

    await expect(runtime.handleInbound({
      channelAccountId: 'a1',
      channelType: 'feishu',
      externalUserId: 'u1',
      externalDisplayName: '用户',
      externalChatId: 'chat-1',
      externalMessageId: 'e-mode-index',
      text: '/mode 2',
    })).resolves.toEqual({
      kind: 'command',
      message: '已切换权限模式：自动审查',
      conversationId: 'c1',
    })
    expect(data.channelAccountRepository.updatePermissionMode).toHaveBeenCalledWith('a1', 'hybrid')
  })

  it('/mode 无效序号直接报错', async () => {
    const { runtime, data } = createHarness()

    await expect(runtime.handleInbound({
      channelAccountId: 'a1',
      channelType: 'feishu',
      externalUserId: 'u1',
      externalDisplayName: '用户',
      externalChatId: 'chat-1',
      externalMessageId: 'e-mode-invalid-index',
      text: '/mode 9',
    })).resolves.toEqual({
      kind: 'command',
      message: '权限模式序号无效，请发送 /mode 查看列表。',
      conversationId: 'c1',
    })
    expect(data.channelAccountRepository.updatePermissionMode).not.toHaveBeenCalled()
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
    expect(data.messageRepository.create).not.toHaveBeenCalled()
  })

  it('频道指令执行不写 message 事件', async () => {
    const { runtime, data } = createHarness()

    await expect(runtime.handleInbound({
      channelAccountId: 'a1',
      channelType: 'feishu',
      externalUserId: 'u1',
      externalDisplayName: '用户',
      externalChatId: 'chat-1',
      externalMessageId: 'e-status-no-event',
      text: '/status',
    })).resolves.toMatchObject({ kind: 'command' })

    expect(data.messageRepository.create).not.toHaveBeenCalled()
  })

  it('解析失败或用法错误的指令不写 message 事件', async () => {
    const { runtime, data } = createHarness()

    await expect(runtime.handleInbound({
      channelAccountId: 'a1',
      channelType: 'feishu',
      externalUserId: 'u1',
      externalDisplayName: '用户',
      externalChatId: 'chat-1',
      externalMessageId: 'e-bad-command',
      text: '/foo',
    })).resolves.toEqual({
      kind: 'command',
      message: '无法识别频道命令。发送 /help 查看可用命令。',
      conversationId: 'c1',
    })

    expect(data.messageRepository.create).not.toHaveBeenCalled()
  })

  it('/steer 仍写入 steering 用户消息', async () => {
    const { runtime, data } = createHarness()

    await expect(runtime.handleInbound({
      channelAccountId: 'a1',
      channelType: 'feishu',
      externalUserId: 'u1',
      externalDisplayName: '用户',
      externalChatId: 'chat-1',
      externalMessageId: 'e-steer',
      text: '/steer 保持简洁',
    })).resolves.toEqual({
      kind: 'command',
      message: '当前没有运行中的任务，指令已记录，下次任务开始时生效。',
      conversationId: 'c1',
    })

    expect(data.messageRepository.create).toHaveBeenCalledOnce()
    expect(data.messageRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      convId: 'c1',
      role: 'user',
      eventType: 'steering',
      content: [{ type: 'text', text: '保持简洁' }],
    }))
  })

  it('/steer 在任务运行中注入下一个迭代，不落库', async () => {
    const { runtime, data, injectSteering } = createHarness()
    injectSteering.mockResolvedValue({ id: 'm-injected' } as IMessage)

    await expect(runtime.handleInbound({
      channelAccountId: 'a1',
      channelType: 'feishu',
      externalUserId: 'u1',
      externalDisplayName: '用户',
      externalChatId: 'chat-1',
      externalMessageId: 'e-steer-running',
      text: '/steer 换个思路',
    })).resolves.toEqual({
      kind: 'command',
      message: '已注入当前任务。',
      conversationId: 'c1',
    })

    expect(injectSteering).toHaveBeenCalledWith('c1', '换个思路')
    expect(data.messageRepository.create).not.toHaveBeenCalled()
  })
})
