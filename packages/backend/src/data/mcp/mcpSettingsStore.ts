import type { McpSettingsSchema } from '@ant-chat/shared'
import { randomUUID } from 'node:crypto'
import { McpSettingsSchema as McpSettingsValidator } from '@ant-chat/shared'
import { JsonFileMigrationError, UnsupportedJsonSchemaVersionError, VersionedJsonFileStore } from '../file'
import { DEFAULT_MCP_SETTINGS } from './defaultMcpSettings'

const MCP_SETTINGS_SCHEMA_VERSION = 2
const MCP_SETTINGS_MIGRATIONS = [
  {
    version: 1,
    migrate: (value: unknown) => value,
  },
  {
    version: 2,
    migrate: migrateMcpSettingsV2,
  },
] as const

export interface McpSettingsStoreOptions {
  filePath: string
  initialSettings?: McpSettingsSchema
  resetInvalidFile?: boolean
}

/**
 * v1 将 Streamable HTTP 误称为 sse，且用可变显示名作为唯一身份。
 * 迁移在版本化文件 store 的 read seam 发生，并与 schemaVersion 原子落盘，
 * 因而只会为每个存量配置生成一次稳定身份。
 */
function migrateMcpSettingsV2(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return value

  const settings = value as Record<string, unknown>
  if (!settings.servers || typeof settings.servers !== 'object' || Array.isArray(settings.servers))
    return value

  return {
    ...settings,
    servers: Object.fromEntries(Object.entries(settings.servers as Record<string, unknown>).map(([serverName, config]) => {
      if (!config || typeof config !== 'object' || Array.isArray(config))
        return [serverName, config]

      const legacyConfig = config as Record<string, unknown>
      return [serverName, {
        ...legacyConfig,
        serverId: typeof legacyConfig.serverId === 'string' ? legacyConfig.serverId : randomUUID(),
        transportType: legacyConfig.transportType === 'sse' ? 'streamable-http' : legacyConfig.transportType,
      }]
    })),
  }
}

export class McpSettingsStore {
  private readonly store: VersionedJsonFileStore<McpSettingsSchema>

  constructor(options: McpSettingsStoreOptions) {
    this.store = new VersionedJsonFileStore(options.filePath, {
      currentVersion: MCP_SETTINGS_SCHEMA_VERSION,
      migrations: MCP_SETTINGS_MIGRATIONS,
      parse: (value) => {
        const parsed = McpSettingsValidator.safeParse(value)
        if (!parsed.success) {
          throw new Error(`Invalid MCP settings file: ${options.filePath}: ${parsed.error.message}`)
        }
        return parsed.data
      },
    })
    if (!this.store.exists()) {
      this.write(options.initialSettings ?? DEFAULT_MCP_SETTINGS)
      return
    }

    if (options.resetInvalidFile) {
      try {
        const parsed = McpSettingsValidator.safeParse(this.store.read())
        if (!parsed.success) {
          this.write(options.initialSettings ?? DEFAULT_MCP_SETTINGS)
        }
      }
      catch (error) {
        if (error instanceof UnsupportedJsonSchemaVersionError || error instanceof JsonFileMigrationError) {
          throw error
        }
        this.write(options.initialSettings ?? DEFAULT_MCP_SETTINGS)
      }
    }
  }

  read(): McpSettingsSchema {
    return this.store.read()
  }

  write(settings: McpSettingsSchema): McpSettingsSchema {
    const nextSettings = McpSettingsValidator.parse(settings)
    this.store.write(nextSettings)
    return nextSettings
  }

  update(mutator: (settings: McpSettingsSchema) => McpSettingsSchema): McpSettingsSchema {
    return this.write(mutator(this.read()))
  }
}
