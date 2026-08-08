import type { AgentTaskSnapshot } from '@ant-chat/shared'
import type { ChannelConnector } from '../../../../channels'
import { RuntimeEventBus } from '../../../../events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChannelModule } from '..'

const registerApp = vi.hoisted(() => vi.fn())

vi.mock('@larksuiteoapi/node-sdk', () => ({ registerApp }))

describe('channel module 频道配置（扫码创建 / 重新授权）', () => {
  beforeEach(() => {
    registerApp.mockReset()
  })

  function buildModule(options: { credential?: string | null, existingByType?: boolean } = {}) {
    const account = {
      id: 'a1',
      channelType: 'feishu' as const,
      displayName: '飞书',
      credentialRef: 'credential-1',
      defaultWorkspacePath: '/workspace',
      permissionMode: 'hybrid' as const,
      enabled: true,
      status: 'connected' as const,
      createdAt: 1,
      updatedAt: 1,
    }
    const conversation = {
      id: 'c1',
      workspacePath: '/workspace',
      title: 'Untitled',
      conversationInstructions: '',
      createdAt: 1,
      updatedAt: 1,
      settings: { modelId: 'model-1', providerId: 'provider-1' },
      sourceType: 'feishu' as const,
      sourceChannelAccountId: 'a1',
      sourceExternalChatId: 'chat-1',
    }
    const data = {
      channelAccountRepository: {
        list: vi.fn(async () => [account]),
        getById: vi.fn(async () => account),
        getByType: vi.fn(async () => options.existingByType ? account : undefined),
        upsert: vi.fn(async input => ({ ...account, ...input })),
        updateStatus: vi.fn(),
      },
      channelPairingRepository: {
        get: vi.fn(async () => ({ id: 'pair-1', channelAccountId: 'a1', externalUserId: 'u1', status: 'authorized' as const, requestedAt: 1 })),
      },
      channelReceiptRepository: {
        get: vi.fn(async () => undefined),
        getOutboundByLocalMessageId: vi.fn(async () => undefined),
        create: vi.fn(async input => ({ id: 'receipt', ...input })),
        updateStatus: vi.fn(),
      },
      channelSessionRepository: {
        get: vi.fn(async () => ({ channelAccountId: 'a1', externalChatId: 'chat-1', activeConversationId: 'c1', currentWorkspacePath: '/workspace', createdAt: 1, updatedAt: 1 })),
      },
      workspaceService: {
        listWorkspaces: vi.fn(() => ({ workspaces: [{ path: '/workspace' }] })),
        isWorkspaceAvailable: vi.fn(() => true),
      },
      conversationRepository: {
        getById: vi.fn(async () => conversation),
        update: vi.fn(async input => ({ ...conversation, ...input })),
      },
      messageRepository: {
        create: vi.fn(async () => ({ id: 'command-message' })),
      },
      providerSettingsRepository: {
        getAllAvailableModels: vi.fn(() => []),
      },
    }
    const secretStore = {
      resolve: vi.fn(async () => options.credential === undefined ? JSON.stringify({ appId: 'cli_old', appSecret: 'secret-old' }) : options.credential),
      saveChannelCredential: vi.fn(async (input: { channelAccountId: string, value: string }) => ({ id: `ref-${input.channelAccountId}` })),
      deleteChannelCredential: vi.fn(),
    }
    const connector: ChannelConnector = {
      type: 'feishu',
      capabilities: { supportsUpdate: true },
      setup: vi.fn(async () => ({})),
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      send: vi.fn(async () => ({ externalMessageId: 'reply-1' })),
      sendAttachment: vi.fn(async () => ({ messageId: 'attachment-1' })),
      update: vi.fn(async () => {}),
      setTyping: vi.fn(async () => ({ changed: true })),
      getStatus: vi.fn(() => ({ status: 'connected' as const })),
    }
    const startTurn = vi.fn(async () => ({
      taskId: 'task-1',
      conversationId: 'c1',
      userMessageId: 'local-message-1',
      conversation,
    }))
    const module = new ChannelModule({
      data,
      events: new RuntimeEventBus(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      secretStore,
    } as never, {
      turnService: { startTurn },
      updateConversation: vi.fn(),
      listActiveTasks: vi.fn(() => [] as AgentTaskSnapshot[]),
      approvePendingAction: vi.fn(),
      cancelTask: vi.fn(),
    } as never, [connector])
    return { module, data, secretStore, connector }
  }

  it('创建模式：不传 appId，锁定 createOnly', async () => {
    registerApp.mockImplementation(async (options) => {
      options.onQRCodeReady({ url: 'https://qr.example.com', expireIn: 600 })
      return { client_id: 'cli_new', client_secret: 'secret-new' }
    })
    const { module } = buildModule()

    const result = await module.setup({ channelType: 'feishu', displayName: '新频道', defaultWorkspacePath: '/workspace' })

    expect(result.mode).toBe('create')
    expect(registerApp).toHaveBeenCalledWith(expect.objectContaining({ createOnly: true }))
    expect(registerApp).not.toHaveBeenCalledWith(expect.objectContaining({ appId: expect.any(String) }))
  })

  it('重新授权已有频道：读取凭证中的 appId，扫码完成后更新凭证并保持启用', async () => {
    registerApp.mockImplementation(async (options) => {
      options.onQRCodeReady({ url: 'https://qr.example.com', expireIn: 600 })
      return { client_id: 'cli_new', client_secret: 'secret-new' }
    })
    const { module, data, secretStore, connector } = buildModule()

    const result = await module.setup({ channelType: 'feishu', displayName: '飞书', defaultWorkspacePath: '/workspace', channelAccountId: 'a1' })

    expect(result.mode).toBe('reauth')
    expect(registerApp).toHaveBeenCalledWith(expect.objectContaining({ appId: 'cli_old' }))
    expect(registerApp).toHaveBeenCalledWith(expect.not.objectContaining({ createOnly: true }))
    await vi.waitFor(() => expect(secretStore.saveChannelCredential).toHaveBeenCalledWith({ channelAccountId: 'a1', value: JSON.stringify({ appId: 'cli_new', appSecret: 'secret-new' }) }))
    expect(data.channelAccountRepository.upsert).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1', enabled: true, credentialRef: 'ref-a1', status: 'configured' }))
    await vi.waitFor(() => expect(connector.start).toHaveBeenCalledOnce())
    expect(data.channelAccountRepository.updateStatus).toHaveBeenCalledWith('a1', 'connected')
  })

  it('添加频道时绑定已有应用：以 reauth 模式注册且新账户默认启用', async () => {
    registerApp.mockImplementation(async (options) => {
      options.onQRCodeReady({ url: 'https://qr.example.com', expireIn: 600 })
      return { client_id: 'cli_x', client_secret: 'secret-x' }
    })
    const { module, data, connector } = buildModule()

    const result = await module.setup({ channelType: 'feishu', displayName: '新频道', defaultWorkspacePath: '/workspace', appId: 'cli_x' })

    expect(result.mode).toBe('reauth')
    expect(registerApp).toHaveBeenCalledWith(expect.objectContaining({ appId: 'cli_x' }))
    await vi.waitFor(() => expect(data.channelAccountRepository.upsert).toHaveBeenCalledWith(expect.objectContaining({ enabled: true, status: 'configured' })))
    await vi.waitFor(() => expect(connector.start).toHaveBeenCalledOnce())
  })

  it('已有频道凭证缺失时拒绝重新授权', async () => {
    const { module } = buildModule({ credential: null })

    await expect(module.setup({ channelType: 'feishu', displayName: '飞书', defaultWorkspacePath: '/workspace', channelAccountId: 'a1' }))
      .rejects
      .toThrow('凭证不完整，无法重新授权')
    expect(registerApp).not.toHaveBeenCalled()
  })

  it('已存在同平台频道时，添加模式给出引导而非撞唯一约束', async () => {
    const { module } = buildModule({ existingByType: true })

    await expect(module.setup({ channelType: 'feishu', displayName: '新频道', defaultWorkspacePath: '/workspace' }))
      .rejects
      .toThrow('已存在飞书频道「飞书」。每种平台只支持一个频道，请在该频道上点击「重新授权」，或删除后重新添加。')
    await expect(module.setup({ channelType: 'feishu', displayName: '新频道', defaultWorkspacePath: '/workspace', appId: 'cli_x' }))
      .rejects
      .toThrow('已存在飞书频道')
    expect(registerApp).not.toHaveBeenCalled()
  })
})
