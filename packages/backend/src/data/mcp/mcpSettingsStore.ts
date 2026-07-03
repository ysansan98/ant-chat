import type { McpSettingsSchema } from '@ant-chat/shared'
import { McpSettingsSchema as McpSettingsValidator } from '@ant-chat/shared'
import { JsonFileMigrationError, UnsupportedJsonSchemaVersionError, VersionedJsonFileStore } from '../file'
import { DEFAULT_MCP_SETTINGS } from './defaultMcpSettings'

const MCP_SETTINGS_SCHEMA_VERSION = 1
const MCP_SETTINGS_MIGRATIONS = [
  {
    version: 1,
    migrate: (value: unknown) => value,
  },
] as const

export interface McpSettingsStoreOptions {
  filePath: string
  initialSettings?: McpSettingsSchema
  resetInvalidFile?: boolean
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
