import type {
  AddMcpConfigSchema,
  AppControlCommand,
  AppControlResult,
  AppControlResultFor,
  AutomationCommand,
  AutomationInput,
  ChannelCommand,
  McpCommand,
  McpConnection,
  McpListItem,
  McpServerLifecycleResult,
  ProviderCommand,
  ProviderConfigSchema,
  ProviderListItem,
  SettingsCommand,
} from '@ant-chat/shared'
import type { ControlPlaneModules } from './controlPlane'

/**
 * 应用管理控制面的命令编排器。
 *
 * 它只负责把经过 socket 边界校验的控制命令翻译成领域调用、协调跨模块
 * 操作，以及投影为不含 secret 的返回 DTO。Provider 的密钥生命周期属于
 * ProviderModule，MCP 连接生命周期属于 McpModule。
 */
export class AppControl {
  constructor(private readonly modules: ControlPlaneModules) {}

  async execute(command: AppControlCommand): Promise<AppControlResult> {
    switch (command.type) {
      case 'settings':
        return await this.executeSettings(command)
      case 'provider':
        return await this.executeProvider(command)
      case 'mcp':
        return await this.executeMcp(command)
      case 'automation':
        return await this.executeAutomation(command)
      case 'channel':
        return await this.executeChannel(command)
    }
  }

  private async executeSettings(command: SettingsCommand): Promise<AppControlResultFor<SettingsCommand>> {
    switch (command.action) {
      case 'show': {
        const settings = await this.modules.settings.getSettings()
        return { settings }
      }
      case 'theme:set': {
        const current = await this.modules.settings.getSettings()
        const appearance = {
          ...current.appearance,
          ...(command.mode ? { mode: command.mode } : {}),
          ...(command.lightThemeId ? { lightThemeId: command.lightThemeId } : {}),
          ...(command.darkThemeId ? { darkThemeId: command.darkThemeId } : {}),
        }
        await this.modules.settings.updateSettings({ updates: { appearance } })
        return { mode: appearance.mode }
      }
      case 'assistant:set': {
        // 这是跨 settings/provider 的业务约束，控制面保留编排职责。
        const provider = this.modules.provider.getProviderById({ id: command.providerId })
        if (!provider.isEnabled)
          throw new Error(`Provider is disabled: ${command.providerId}`)

        const model = this.modules.provider.listProviderModels({ id: command.providerId })
          .find(item => item.model === command.modelId)
        if (!model)
          throw new Error(`Model not found: ${command.providerId}/${command.modelId}`)
        if (!model.isEnabled)
          throw new Error(`Model is disabled: ${command.modelId}`)

        await this.modules.settings.updateSettings({
          updates: {
            assistantProviderId: command.providerId,
            assistantModelId: command.modelId,
          },
        })
        return { providerId: command.providerId, modelId: command.modelId }
      }
      case 'proxy:set': {
        const current = await this.modules.settings.getSettings()
        const proxySettings = command.mode === 'none'
          ? { mode: 'none' as const }
          : command.mode === 'system'
            ? { mode: 'system' as const }
            : { mode: 'custom' as const, customProxyUrl: command.url ?? current.proxySettings.customProxyUrl }
        await this.modules.settings.updateSettings({ updates: { proxySettings } })
        return { mode: command.mode }
      }
      case 'proxy:test': {
        const current = await this.modules.settings.getSettings()
        const proxyUrl = command.url ?? current.proxySettings.customProxyUrl
        const ok = proxyUrl ? await this.modules.settings.testProxyConnection({ proxyUrl }) : false
        return { ok }
      }
    }
  }

  private async executeProvider(command: ProviderCommand): Promise<AppControlResultFor<ProviderCommand>> {
    switch (command.action) {
      case 'list':
        return { providers: this.modules.provider.listProviders().map(toPublicProvider) }
      case 'get':
        return { provider: toPublicProvider(this.modules.provider.getProviderById({ id: command.id })) }
      case 'create': {
        const provider = await this.modules.provider.createProvider({
          config: {
            name: command.name,
            baseUrl: command.baseUrl,
            apiMode: command.apiMode,
            apiKey: command.apiKey,
            isOfficial: command.isOfficial ?? false,
            isEnabled: command.isEnabled ?? true,
          },
        })
        return { provider: toPublicProvider(provider) }
      }
      case 'update': {
        const provider = await this.modules.provider.updateProvider({
          config: {
            id: command.id,
            ...omitUndefined({
              name: command.name,
              baseUrl: command.baseUrl,
              apiMode: command.apiMode,
              apiKey: command.apiKey,
              isOfficial: command.isOfficial,
              isEnabled: command.isEnabled,
            }),
          },
        })
        return { provider: toPublicProvider(provider) }
      }
      case 'delete':
        await this.modules.provider.deleteProvider({ id: command.id })
        return { deleted: true }
      case 'enable':
        await this.modules.provider.updateProvider({ config: { id: command.id, isEnabled: true } })
        return { id: command.id, enabled: true }
      case 'disable':
        await this.modules.provider.updateProvider({ config: { id: command.id, isEnabled: false } })
        return { id: command.id, enabled: false }
      case 'models':
        return {
          models: this.modules.provider.listProviderModels({ id: command.id }).map(model => ({
            id: model.id,
            modelId: model.model,
            providerId: model.providerId,
            displayName: model.name,
            isEnabled: model.isEnabled,
          })),
        }
      case 'key:set':
        await this.modules.provider.updateProvider({ config: { id: command.id, apiKey: command.apiKey } })
        return { id: command.id, hasApiKey: true }
      case 'key:clear':
        await this.modules.provider.updateProvider({ config: { id: command.id, apiKey: '' } })
        return { id: command.id }
    }
  }

  private async executeMcp(command: McpCommand): Promise<AppControlResultFor<McpCommand>> {
    switch (command.action) {
      case 'list': {
        const activeConnections = new Map(this.modules.mcp.getConnections().map(connection => [connection.name, connection]))
        const mcpServers = this.modules.mcp.getConfigs().map((config) => {
          const connection = activeConnections.get(config.serverName)
          return toMcpConnection(config.serverName, config.transportType, connection)
        })
        return { mcpServers }
      }
      case 'get': {
        const config = this.modules.mcp.getConfigByServerName({ serverName: command.name })
        const connection = this.modules.mcp.getConnections().find(item => item.name === command.name)
        return { mcpServer: toMcpConnection(command.name, config.transportType, connection) }
      }
      case 'install': {
        const result = await this.modules.mcp.installServer({ config: toMcpInstallConfig(command) })
        return { mcpServer: toMcpListItem(result) }
      }
      case 'edit': {
        const result = await this.modules.mcp.editServer({
          serverName: command.serverName,
          updates: omitUndefined({
            transportType: command.transportType,
            command: command.command,
            args: command.args,
            env: command.env,
            url: command.url,
            headers: command.headers,
            icon: command.icon,
            description: command.description,
            timeout: command.timeout,
          }),
        })
        return { mcpServer: toMcpListItem(result) }
      }
      case 'delete': {
        const result = await this.modules.mcp.deleteServer({
          serverName: command.name,
          deletePermissionRules: true,
        })
        return {
          deleted: !result.error,
          ...(result.error ? { error: result.error } : {}),
        }
      }
      case 'start': {
        const result = await this.modules.mcp.startServer({ serverName: command.name })
        return {
          name: command.name,
          status: result.status,
          ...(result.error ? { error: result.error } : {}),
        }
      }
      case 'stop': {
        const result = await this.modules.mcp.stopServer({ serverName: command.name })
        return {
          name: command.name,
          status: result.status,
          ...(result.error ? { error: result.error } : {}),
        }
      }
    }
  }

  private async executeAutomation(command: AutomationCommand): Promise<AppControlResultFor<AutomationCommand>> {
    switch (command.action) {
      case 'list':
        return { automations: await this.modules.automation.list() }
      case 'get':
        return { automation: await this.modules.automation.get(command.id) }
      case 'create':
        return { automation: await this.modules.automation.create({ input: toAutomationInput(command) }) }
      case 'delete':
        await this.modules.automation.safeDelete(command.id, command.force)
        return { deleted: true }
      case 'runs':
        return { runs: await this.modules.automation.listRuns({ automationId: command.id }) }
    }
  }

  private async executeChannel(command: ChannelCommand): Promise<AppControlResultFor<ChannelCommand>> {
    if (!this.modules.channel)
      throw new Error('频道模块不可用')
    switch (command.action) {
      case 'list': return { channels: await this.modules.channel.list() }
      case 'setup': return await this.modules.channel.setup(command)
      case 'disconnect': return { channel: await this.modules.channel.disconnect({ id: command.id }) }
      case 'listPairingRequests': return { pairings: await this.modules.channel.listPairingRequests({ channelAccountId: command.channelAccountId }) }
      case 'rejectPairing': return { pairing: await this.modules.channel.rejectPairing({ id: command.id }) }
      case 'create': return { channel: await this.modules.channel.create(command) }
      case 'delete': {
        await this.modules.channel.delete({ id: command.id })
        return { deleted: true }
      }
      case 'listPairings': return { pairings: await this.modules.channel.listPairings({ channelAccountId: command.channelAccountId }) }
      case 'approvePairing': return { pairing: await this.modules.channel.approvePairing({ id: command.id }) }
      case 'revokePairing': return { pairing: await this.modules.channel.revokePairing({ id: command.id }) }
      case 'getStatus': return this.modules.channel.getStatus({ channelType: command.channelType })
      case 'enable': return this.modules.channel.enable({ id: command.id })
      case 'disable': return this.modules.channel.disable({ id: command.id })
    }
  }
}

function toPublicProvider(provider: ProviderConfigSchema): ProviderListItem {
  return {
    id: provider.id,
    name: provider.name,
    baseUrl: provider.baseUrl,
    apiMode: provider.apiMode,
    hasApiKey: provider.hasApiKey ?? false,
    isOfficial: provider.isOfficial,
    isEnabled: provider.isEnabled,
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt,
  }
}

function toMcpConnection(name: string, config: string, connection?: McpConnection): McpConnection {
  return {
    name,
    config,
    status: connection?.status ?? 'disconnected',
    tools: connection?.tools,
  }
}

function toMcpInstallConfig(command: Extract<McpCommand, { action: 'install' }>): AddMcpConfigSchema {
  const icon = command.icon ?? (command.transportType === 'stdio' ? 'terminal' : 'globe')
  if (command.transportType === 'stdio') {
    return {
      serverName: command.serverName,
      transportType: command.transportType,
      command: command.command,
      args: command.args,
      env: command.env,
      icon,
      description: command.description,
      timeout: command.timeout,
    }
  }
  return {
    serverName: command.serverName,
    transportType: command.transportType,
    url: command.url,
    headers: command.headers,
    icon,
    description: command.description,
    timeout: command.timeout,
  }
}

function toMcpListItem(result: McpServerLifecycleResult): McpListItem {
  return {
    name: result.serverName,
    config: result.transportType,
    status: result.status,
    ...(result.error ? { error: result.error } : {}),
  }
}

function toAutomationInput(command: Extract<AutomationCommand, { action: 'create' }>): AutomationInput {
  const policy = command.permissionPolicy
  return {
    name: command.name,
    prompt: command.prompt,
    workspacePath: command.workspacePath,
    providerId: command.providerId,
    modelId: command.modelId,
    schedule: command.schedule,
    allowedSkills: command.allowedSkills ?? [],
    allowedMcpServers: command.allowedMcpServers ?? [],
    permissionPolicy: {
      workspaceAccess: policy?.workspaceAccess ?? 'read',
      allowSelectedSkillRuntime: policy?.allowSelectedSkillRuntime ?? policy?.allowSkillScripts ?? false,
      allowBrowser: policy?.allowBrowser ?? false,
      allowMcpTools: policy?.allowMcpTools ?? false,
      extraFileRoots: policy?.extraFileRoots ?? [],
      allowCommandExecution: policy?.allowCommandExecution ?? false,
      commandPatterns: policy?.commandPatterns ?? [],
    },
    enabled: command.enabled ?? true,
  }
}

function omitUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>
}
