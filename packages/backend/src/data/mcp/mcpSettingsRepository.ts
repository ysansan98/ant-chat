import type { AddMcpConfigSchema, McpConfigSchema } from '@ant-chat/shared'
import type { McpSettingsStore } from './mcpSettingsStore'
import { AddMcpConfigSchema as AddMcpConfigValidator } from '@ant-chat/shared'

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
        throw new Error(`MCP server 已存在：${data.serverName}`)
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

  replaceMcpConfig(serverName: string, config: AddMcpConfigSchema): McpConfigSchema {
    const data = AddMcpConfigValidator.parse(config)
    this.store.update((settings) => {
      if (!settings.servers[serverName])
        throw new Error(`MCP server 不存在：${serverName}`)
      if (serverName !== data.serverName && settings.servers[data.serverName])
        throw new Error(`MCP server 已存在：${data.serverName}`)

      const { [serverName]: _oldConfig, ...servers } = settings.servers
      return {
        ...settings,
        servers: { ...servers, [data.serverName]: data },
      }
    })
    return data
  }

  deleteMcpConfig(serverName: string): boolean {
    this.store.update((settings) => {
      const { [serverName]: _deletedConfig, ...servers } = settings.servers
      return { ...settings, servers }
    })
    return true
  }
}
