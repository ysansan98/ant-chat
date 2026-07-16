import type { AppControlCommand } from '@ant-chat/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppControl } from './appControl'

describe('appControl 行为', () => {
  const settings = {
    getSettings: vi.fn(),
    testProxyConnection: vi.fn(),
    updateSettings: vi.fn(),
  }
  const provider = {
    createProvider: vi.fn(),
    deleteProvider: vi.fn(),
    getProviderById: vi.fn(),
    listProviderModels: vi.fn(),
    listProviders: vi.fn(),
    updateProvider: vi.fn(),
  }
  const mcp = {
    deleteServer: vi.fn(),
    editServer: vi.fn(),
    getConfigByServerName: vi.fn(),
    getConfigs: vi.fn(),
    getConnections: vi.fn(),
    installServer: vi.fn(),
    startServer: vi.fn(),
    stopServer: vi.fn(),
  }
  const automation = {
    create: vi.fn(),
    get: vi.fn(),
    list: vi.fn(),
    listRuns: vi.fn(),
    safeDelete: vi.fn(),
  }
  beforeEach(() => {
    vi.clearAllMocks()
    settings.getSettings.mockResolvedValue({
      appearance: { darkThemeId: 'default', lightThemeId: 'default', mode: 'system' },
      assistantModelId: '',
      assistantProviderId: '',
      proxySettings: { mode: 'none' },
    })
    provider.listProviders.mockReturnValue([])
    mcp.getConfigs.mockReturnValue([])
    mcp.getConnections.mockReturnValue([])
  })

  function createControl() {
    return new AppControl({ automation, mcp, provider, settings })
  }

  it('保存真实 API Key 时交由 provider module 管理密钥生命周期', async () => {
    provider.updateProvider.mockResolvedValue({ id: 'provider-1', hasApiKey: true })

    await expect(createControl().execute({
      action: 'key:set',
      apiKey: 'sk-secret',
      id: 'provider-1',
      type: 'provider',
    })).resolves.toEqual({ hasApiKey: true, id: 'provider-1' })

    expect(provider.updateProvider).toHaveBeenCalledWith({
      config: { apiKey: 'sk-secret', id: 'provider-1' },
    })
  })

  it('拒绝把已停用 provider 设为助理模型', async () => {
    provider.getProviderById.mockReturnValue({ id: 'provider-1', isEnabled: false })
    provider.listProviderModels.mockReturnValue([{ isEnabled: true, model: 'model-1' }])

    await expect(createControl().execute({
      action: 'assistant:set',
      modelId: 'model-1',
      providerId: 'provider-1',
      type: 'settings',
    })).rejects.toThrow('Provider is disabled')
  })

  it('一次更新模式和亮暗主题', async () => {
    await createControl().execute({
      action: 'theme:set',
      darkThemeId: 'cursor',
      lightThemeId: 'airbnb',
      mode: 'dark',
      type: 'settings',
    } as AppControlCommand)

    expect(settings.updateSettings).toHaveBeenCalledWith({
      updates: {
        appearance: {
          darkThemeId: 'cursor',
          lightThemeId: 'airbnb',
          mode: 'dark',
        },
      },
    })
  })

  it('mCP 安装失败时返回已保存配置和连接错误', async () => {
    mcp.installServer.mockResolvedValue({ error: 'connection refused', serverName: 'demo', status: 'disconnected', transportType: 'stdio' })

    await expect(createControl().execute({
      action: 'install',
      command: 'node',
      serverName: 'demo',
      transportType: 'stdio',
      type: 'mcp',
    })).resolves.toEqual({
      mcpServer: {
        config: 'stdio',
        error: 'connection refused',
        name: 'demo',
        status: 'disconnected',
      },
    })
  })

  it('编辑 MCP 时只映射 patch，由生命周期 module 合并配置', async () => {
    mcp.getConfigByServerName.mockReturnValue({
      args: ['server.js'],
      command: 'node',
      description: '旧说明',
      icon: 'terminal',
      serverName: 'demo',
      transportType: 'stdio',
    })
    mcp.editServer.mockResolvedValue({ serverName: 'demo', status: 'disconnected', transportType: 'stdio' })

    await createControl().execute({
      action: 'edit',
      description: '新说明',
      serverName: 'demo',
      type: 'mcp',
    })

    expect(mcp.editServer).toHaveBeenCalledWith({
      serverName: 'demo',
      updates: {
        description: '新说明',
      },
    })
  })

  it('查询已连接 MCP 时不返回包含凭据的原始配置', async () => {
    mcp.getConfigByServerName.mockReturnValue({
      headers: { Authorization: 'Bearer secret' },
      serverName: 'demo',
      transportType: 'sse',
      url: 'https://example.com/mcp',
    })
    mcp.getConnections.mockReturnValue([{
      config: JSON.stringify({ headers: { Authorization: 'Bearer secret' } }),
      name: 'demo',
      status: 'connected',
      tools: [{ name: 'search' }],
    }])

    await expect(createControl().execute({
      action: 'get',
      name: 'demo',
      type: 'mcp',
    })).resolves.toEqual({
      mcpServer: {
        config: 'sse',
        name: 'demo',
        status: 'connected',
        tools: [{ name: 'search' }],
      },
    })
  })

  it('provider 控制结果不返回 API Key 或 secret ref', async () => {
    provider.getProviderById.mockReturnValue({
      apiKey: 'sk-secret',
      apiKeySecretId: 'provider:provider-1:api_key',
      apiMode: 'openai',
      baseUrl: 'https://example.com/v1',
      createdAt: 1,
      hasApiKey: true,
      id: 'provider-1',
      isEnabled: true,
      isOfficial: false,
      name: 'Example',
      updatedAt: 2,
    })

    await expect(createControl().execute({ action: 'get', id: 'provider-1', type: 'provider' })).resolves.toEqual({
      provider: {
        apiMode: 'openai',
        baseUrl: 'https://example.com/v1',
        createdAt: 1,
        hasApiKey: true,
        id: 'provider-1',
        isEnabled: true,
        isOfficial: false,
        name: 'Example',
        updatedAt: 2,
      },
    })
  })

  it('automation get 直接委托领域读取入口', async () => {
    automation.get.mockResolvedValue({ id: 'automation-1', name: '每日检查' })

    await expect(createControl().execute({ action: 'get', id: 'automation-1', type: 'automation' })).resolves.toEqual({
      automation: { id: 'automation-1', name: '每日检查' },
    })

    expect(automation.get).toHaveBeenCalledWith('automation-1')
    expect(automation.list).not.toHaveBeenCalled()
  })

  it('provider 更新只向业务模块传递白名单字段', async () => {
    provider.updateProvider.mockResolvedValue({ id: 'provider-1' })

    await createControl().execute({
      action: 'update',
      apiKeySecretId: 'forged-secret-ref',
      baseUrl: 'https://example.com/v1',
      id: 'provider-1',
      type: 'provider',
    } as unknown as AppControlCommand)

    expect(provider.updateProvider).toHaveBeenCalledWith({
      config: {
        baseUrl: 'https://example.com/v1',
        id: 'provider-1',
      },
    })
  })

  it('provider enable/disable 复用 updateProvider 而非控制面专属方法', async () => {
    provider.updateProvider.mockResolvedValue({ id: 'provider-1', isEnabled: true })

    await createControl().execute({ action: 'enable', id: 'provider-1', type: 'provider' })
    expect(provider.updateProvider).toHaveBeenLastCalledWith({
      config: { id: 'provider-1', isEnabled: true },
    })

    await createControl().execute({ action: 'disable', id: 'provider-1', type: 'provider' })
    expect(provider.updateProvider).toHaveBeenLastCalledWith({
      config: { id: 'provider-1', isEnabled: false },
    })
  })

  it('settings show 无参读取，不再向运行时模块传 undefined as never', async () => {
    settings.getSettings.mockResolvedValue({
      appearance: { darkThemeId: 'default', lightThemeId: 'default', mode: 'system' },
      assistantModelId: '',
      assistantProviderId: '',
      proxySettings: { mode: 'none' },
    })

    await createControl().execute({ action: 'show', type: 'settings' })

    expect(settings.getSettings).toHaveBeenCalledWith()
  })
})
