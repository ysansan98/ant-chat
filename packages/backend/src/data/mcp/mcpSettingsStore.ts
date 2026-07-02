import type { McpSettingsSchema } from '@ant-chat/shared'
import { McpSettingsSchema as McpSettingsValidator } from '@ant-chat/shared'
import { AtomicJsonFileStore } from '../file'
import { DEFAULT_MCP_SETTINGS } from './defaultMcpSettings'

export interface McpSettingsStoreOptions {
  filePath: string
  initialSettings?: McpSettingsSchema
  resetInvalidFile?: boolean
}

export class McpSettingsStore {
  private readonly store: AtomicJsonFileStore<McpSettingsSchema>

  constructor(private readonly options: McpSettingsStoreOptions) {
    this.store = new AtomicJsonFileStore(options.filePath)
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
      catch {
        this.write(options.initialSettings ?? DEFAULT_MCP_SETTINGS)
      }
    }
  }

  read(): McpSettingsSchema {
    const parsed = McpSettingsValidator.safeParse(this.store.read())
    if (!parsed.success) {
      throw new Error(`Invalid MCP settings file: ${this.options.filePath}: ${parsed.error.message}`)
    }
    return parsed.data
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
