import type { AddMcpConfigSchema, McpConfigSchema, UpdateMcpConfigSchema } from '@ant-chat/shared'
import type { McpSettingsStore } from './mcpSettingsStore'
import { AddMcpConfigSchema as AddMcpConfigValidator, UpdateMcpConfigSchema as UpdateMcpConfigValidator } from '@ant-chat/shared'

export class McpSettingsRepository {
  constructor(private readonly store: McpSettingsStore) {}

  getMcpConfigs(): McpConfigSchema[] {
    return Object.values(this.store.read().servers)
  }

  getMcpConfigByServerName(serverName: string): McpConfigSchema | null {
    return this.store.read().servers[serverName] ?? null
  }

  addMcpConfig(config: AddMcpConfigSchema): McpConfigSchema {
    const data = AddMcpConfigValidator.parse(config)
    this.store.update((settings) => {
      if (settings.servers[data.serverName]) {
        throw new Error(`MCP server already exists: ${data.serverName}`)
      }
      return {
        ...settings,
        servers: {
          ...settings.servers,
          [data.serverName]: data,
        },
      }
    })
    return data
  }

  updateMcpConfig(config: UpdateMcpConfigSchema): McpConfigSchema {
    const data = UpdateMcpConfigValidator.parse(config)
    let updatedConfig: McpConfigSchema | null = null
    this.store.update((settings) => {
      const currentConfig = settings.servers[data.serverName]
      if (!currentConfig) {
        throw new Error(`MCP server not found: ${data.serverName}`)
      }
      updatedConfig = {
        ...currentConfig,
        ...data,
      } as McpConfigSchema
      return {
        ...settings,
        servers: {
          ...settings.servers,
          [data.serverName]: updatedConfig,
        },
      }
    })
    if (!updatedConfig) {
      throw new Error(`MCP server not found: ${data.serverName}`)
    }
    return updatedConfig
  }

  deleteMcpConfig(serverName: string): boolean {
    this.store.update((settings) => {
      const { [serverName]: _deletedConfig, ...servers } = settings.servers
      return { ...settings, servers }
    })
    return true
  }
}
