import type {
  AppControlCommand,
  AppControlResult,
  McpConfigSchema,
  McpConnection,
} from '@ant-chat/shared'
import type { AutomationModule } from '../app-runtime/modules/automation'
import type { McpModule } from '../app-runtime/modules/mcp'
import type { ProviderModule } from '../app-runtime/modules/provider'
import type { SettingsModule } from '../app-runtime/modules/settings'
import type { KeychainSecretStore } from '../secretStore'

/**
 * AppControl — 应用管理的控制面编排模块。
 *
 * 职责：
 * 1. 校验命令合法性（白名单）。
 * 2. 路由到对应业务模块。
 * 3. 统一脱敏（Secret、API Key 只返回 hasApiKey 布尔值）。
 * 4. 合并结果到 AppControlResult。
 *
 * 调用方（CLI / 原生 Agent 工具 / AppRuntime）都通过同一个 execute 入口。
 */
export class AppControl {
  constructor(
    private readonly modules: {
      settings: SettingsModule
      provider: ProviderModule
      mcp: McpModule
      automation: AutomationModule
    },
    private readonly secretStore: KeychainSecretStore,
  ) {}

  async execute(command: AppControlCommand): Promise<AppControlResult> {
    switch (command.type) {
      // ── 设置 ──────────────────────────────────────
      case 'settings': {
        switch (command.action) {
          case 'show': {
            const settings = await this.modules.settings.getSettings(undefined as never)
            return { settings } as AppControlResult
          }
          case 'theme:set': {
            const current = await this.modules.settings.getSettings(undefined as never)
            const appearance = {
              ...current.appearance,
              ...(command.mode ? { mode: command.mode } : {}),
              ...(command.lightThemeId ? { lightThemeId: command.lightThemeId } : {}),
              ...(command.darkThemeId ? { darkThemeId: command.darkThemeId } : {}),
            }
            if (!command.mode && !command.lightThemeId && !command.darkThemeId) {
              throw new Error('theme:set 至少需要 mode、lightThemeId 或 darkThemeId')
            }
            await this.modules.settings.updateSettings({
              updates: { appearance },
            })
            return { mode: appearance.mode } as AppControlResult
          }
          case 'assistant:set': {
            // 验证 provider/model 组合存在且已启用
            const provider = this.modules.provider.listProviders(undefined as never)
              .find(p => p.id === command.providerId)
            if (!provider) {
              throw new Error(`Provider not found: ${command.providerId}`)
            }
            if (!provider.isEnabled) {
              throw new Error(`Provider is disabled: ${command.providerId}`)
            }

            const models = this.modules.provider.listProviderModels({ id: command.providerId })
            const model = models.find(m => m.model === command.modelId)
            if (!model) {
              throw new Error(`Model not found: ${command.providerId}/${command.modelId}`)
            }
            if (!model.isEnabled) {
              throw new Error(`Model is disabled: ${command.modelId}`)
            }

            await this.modules.settings.updateSettings({
              updates: {
                assistantProviderId: command.providerId,
                assistantModelId: command.modelId,
              },
            })
            return { providerId: command.providerId, modelId: command.modelId } as AppControlResult
          }
          case 'proxy:set': {
            const { mode, url } = command
            const current = await this.modules.settings.getSettings(undefined as never)
            const proxySettings = mode === 'none'
              ? { mode: 'none' as const }
              : mode === 'system'
                ? { mode: 'system' as const }
                : { mode: 'custom' as const, customProxyUrl: url ?? current.proxySettings.customProxyUrl }
            await this.modules.settings.updateSettings({
              updates: { proxySettings },
            })
            return { mode } as AppControlResult
          }
          case 'proxy:test': {
            const current = await this.modules.settings.getSettings(undefined as never)
            const proxyUrl = command.url ?? current.proxySettings.customProxyUrl
            const ok = proxyUrl ? await this.modules.settings.testProxyConnection({ proxyUrl }) : false
            return { ok } as AppControlResult
          }
          default:
            throw new Error(`Unknown settings action: ${(command as AppControlCommand & { action: string }).action}`)
        }
      }

      // ── AI 服务商 ────────────────────────────────
      case 'provider': {
        switch (command.action) {
          case 'list': {
            const providers = this.modules.provider.listProviders(undefined as never)
            return {
              providers: providers.map(p => ({
                id: p.id,
                name: p.name,
                baseUrl: p.baseUrl,
                apiMode: p.apiMode,
                hasApiKey: p.hasApiKey ?? false,
                isOfficial: p.isOfficial,
                isEnabled: p.isEnabled,
                createdAt: p.createdAt,
                updatedAt: p.updatedAt,
              })),
            } as AppControlResult
          }
          case 'get': {
            const provider = this.modules.provider.getProviderById({ id: command.id })
            return { provider: { ...provider, apiKey: undefined } } as AppControlResult
          }
          case 'create': {
            const { name, baseUrl, apiMode, apiKey, isOfficial, isEnabled } = command
            const provider = await this.modules.provider.createProvider({
              config: {
                name,
                baseUrl,
                apiMode,
                apiKey,
                isOfficial: isOfficial ?? false,
                isEnabled: isEnabled ?? true,
              },
            })
            return { provider } as AppControlResult
          }
          case 'update': {
            const { id, name, baseUrl, apiMode, apiKey, isOfficial, isEnabled } = command
            const provider = await this.modules.provider.updateProvider({
              config: { id, ...omitUndefined({ name, baseUrl, apiMode, apiKey, isOfficial, isEnabled }) },
            })
            return { provider } as AppControlResult
          }
          case 'delete': {
            await this.modules.provider.deleteProvider({ id: command.id })
            return { deleted: true } as AppControlResult
          }
          case 'enable': {
            await this.modules.provider.setProviderEnabled(command.id, true)
            return { id: command.id, enabled: true } as AppControlResult
          }
          case 'disable': {
            await this.modules.provider.setProviderEnabled(command.id, false)
            return { id: command.id, enabled: false } as AppControlResult
          }
          case 'models': {
            const models = this.modules.provider.listProviderModels({ id: command.id })
            return {
              models: models.map(m => ({
                id: m.id,
                modelId: m.model,
                providerId: m.providerId,
                displayName: m.name,
                isEnabled: m.isEnabled,
              })),
            } as AppControlResult
          }
          case 'key:set': {
            if (!command.apiKey) {
              throw new Error('API Key 不能为空')
            }
            this.modules.provider.getProviderById({ id: command.id })
            const ref = await this.secretStore.saveProviderApiKey({ providerId: command.id, apiKey: command.apiKey })
            await this.modules.provider.updateProvider({ config: { apiKeySecretId: ref.id, id: command.id } })
            return { id: command.id, hasApiKey: true } as AppControlResult
          }
          case 'key:clear': {
            this.modules.provider.getProviderById({ id: command.id })
            await this.secretStore.deleteProviderApiKey(command.id)
            await this.modules.provider.updateProvider({ config: { apiKeySecretId: undefined, id: command.id } })
            return { id: command.id } as AppControlResult
          }
          default:
            throw new Error(`Unknown provider action: ${(command as AppControlCommand & { action: string }).action}`)
        }
      }

      // ── MCP ───────────────────────────────────────
      case 'mcp': {
        switch (command.action) {
          case 'list': {
            const configs = this.modules.mcp.getConfigs(undefined as never)
            const activeConnections = this.modules.mcp.getConnections(undefined as never)
            const connections: McpConnection[] = configs.map((cfg: McpConfigSchema) => {
              const conn = activeConnections.find((c: McpConnection) => c.name === cfg.serverName)
              return {
                name: cfg.serverName,
                config: cfg.transportType,
                status: conn?.status ?? ('disconnected' as const),
                tools: conn?.tools,
              }
            })
            return { mcpServers: connections } as AppControlResult
          }
          case 'get': {
            const config = this.modules.mcp.getConfigByServerName({ serverName: command.name })
            const connection = this.modules.mcp.getConnections(undefined as never)
              .find((c: McpConnection) => c.name === command.name)
            return {
              mcpServer: {
                name: command.name,
                config: config.transportType,
                status: connection?.status ?? 'disconnected',
                tools: connection?.tools,
              },
            } as AppControlResult
          }
          case 'install': {
            const { serverName, transportType, command: cmd, args, env, url, headers, icon, description, timeout } = command
            const resolvedIcon = icon ?? (transportType === 'stdio' ? 'terminal' : 'globe')
            const config = transportType === 'stdio'
              ? { serverName, transportType, command: cmd, args, env, icon: resolvedIcon, description, timeout }
              : { serverName, transportType, url, headers, icon: resolvedIcon, description, timeout }
            const result = await this.modules.mcp.installServer(config as McpConfigSchema)
            return {
              mcpServer: {
                config: transportType,
                error: result.error,
                name: result.serverName,
                status: result.status as 'connected' | 'connecting' | 'disconnected',
              },
            } as AppControlResult
          }
          case 'edit': {
            const { serverName, transportType, command: executable, args, env, url, headers, icon, description, timeout } = command
            const existing = this.modules.mcp.getConfigByServerName({ serverName })
            const tType = transportType ?? existing.transportType
            const patch = omitUndefined({ command: executable, args, env, url, headers, icon, description, timeout })
            const merged = { ...existing, ...patch, serverName, transportType: tType }
            const config = tType === 'stdio'
              ? omitKeys(merged, ['headers', 'url'])
              : omitKeys(merged, ['args', 'command', 'env'])
            const result = await this.modules.mcp.editServer(config as McpConfigSchema)
            return {
              mcpServer: {
                config: tType,
                error: result.error,
                name: result.serverName,
                status: result.status as 'connected' | 'connecting' | 'disconnected',
              },
            } as AppControlResult
          }
          case 'delete': {
            await this.modules.mcp.deleteServer(command.name)
            return { deleted: true } as AppControlResult
          }
          case 'start': {
            const result = await this.modules.mcp.startServer(command.name)
            return { name: command.name, status: result.status } as AppControlResult
          }
          case 'stop': {
            const result = await this.modules.mcp.stopServer(command.name)
            return { name: command.name, status: result.status } as AppControlResult
          }
          default:
            throw new Error(`Unknown mcp action: ${(command as AppControlCommand & { action: string }).action}`)
        }
      }

      // ── 自动化 ─────────────────────────────────────
      case 'automation': {
        switch (command.action) {
          case 'list': {
            const automations = await this.modules.automation.list(undefined as never)
            return { automations } as AppControlResult
          }
          case 'get': {
            const automations = await this.modules.automation.list(undefined as never)
            const automation = automations.find(item => item.id === command.id)
            if (!automation) {
              throw new Error(`Automation not found: ${command.id}`)
            }
            return { automation } as AppControlResult
          }
          case 'create': {
            const { name, prompt, workspacePath, providerId, modelId, schedule, allowedSkills, allowedMcpServers, permissionPolicy, enabled } = command
            const automation = await this.modules.automation.create({
              input: {
                name,
                prompt,
                workspacePath,
                providerId,
                modelId,
                schedule,
                allowedSkills: allowedSkills ?? [],
                allowedMcpServers: allowedMcpServers ?? [],
                permissionPolicy: {
                  workspaceAccess: permissionPolicy?.workspaceAccess ?? 'read',
                  allowSelectedSkillRuntime: permissionPolicy?.allowSelectedSkillRuntime ?? permissionPolicy?.allowSkillScripts ?? false,
                  allowMcpMutations: permissionPolicy?.allowMcpMutations ?? false,
                  extraFileRoots: permissionPolicy?.extraFileRoots ?? [],
                  allowBashCommands: permissionPolicy?.allowBashCommands ?? false,
                  bashCommandPatterns: permissionPolicy?.bashCommandPatterns ?? [],
                },
                enabled: enabled ?? true,
              },
            })
            return { automation } as AppControlResult
          }
          case 'delete': {
            await this.modules.automation.safeDelete(command.id, command.force)
            return { deleted: true } as AppControlResult
          }
          case 'runs': {
            const runs = await this.modules.automation.listRuns({ automationId: command.id })
            return { runs } as AppControlResult
          }
          default:
            throw new Error(`Unknown automation action: ${(command as AppControlCommand & { action: string }).action}`)
        }
      }

      default:
        throw new Error(`Unknown command type: ${(command as AppControlCommand & { type: string }).type}`)
    }
  }
}

function omitKeys<T extends Record<string, unknown>>(value: T, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)))
}

function omitUndefined<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined))
}
