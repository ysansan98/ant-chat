import type { AppSettingsState } from '@ant-chat/shared'
import { AppSettingsSchema } from '@ant-chat/shared'
import { JsonFileMigrationError, UnsupportedJsonSchemaVersionError, VersionedJsonFileStore } from '../file'
import { DEFAULT_APP_SETTINGS } from './defaultAppSettings'

const APP_SETTINGS_SCHEMA_VERSION = 4
const APP_SETTINGS_MIGRATIONS = [
  {
    version: 1,
    migrate: (value: unknown) => value,
  },
  {
    version: 2,
    migrate: migrateProviderModelOutputTokens,
  },
  {
    version: 3,
    migrate: revokeLegacyToolApprovalWhitelist,
  },
  {
    version: 4,
    migrate: removeLegacyToolApprovalWhitelist,
  },
] as const

/**
 * 旧版 provider model 使用 maxTokens；文件迁移后只保留语义明确的输出上限字段。
 */
function migrateProviderModelOutputTokens(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.providers)) {
    return value
  }

  for (const provider of value.providers) {
    if (!isRecord(provider) || !isRecord(provider.models)) {
      continue
    }
    for (const model of Object.values(provider.models)) {
      if (!isRecord(model)) {
        continue
      }
      if (model.maxOutputTokens === undefined && model.maxTokens !== undefined) {
        model.maxOutputTokens = model.maxTokens
      }
      delete model.maxTokens
    }
  }

  return value
}

/** v3 延续已发布的安全策略：无法还原边界的旧 glob 授权全部撤销。 */
function revokeLegacyToolApprovalWhitelist(value: unknown): unknown {
  if (isRecord(value) && Array.isArray(value.toolApprovalWhitelist))
    value.toolApprovalWhitelist = []
  return value
}

/** v4 从通用设置中彻底删除旧字段，不迁移或双写到独立权限文件。 */
function removeLegacyToolApprovalWhitelist(value: unknown): unknown {
  if (isRecord(value))
    delete value.toolApprovalWhitelist
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export interface AppSettingsStoreOptions {
  filePath: string
  initialSettings?: AppSettingsState
  resetInvalidFile?: boolean
}

export class AppSettingsStore {
  private readonly store: VersionedJsonFileStore<AppSettingsState>

  constructor(private readonly options: AppSettingsStoreOptions) {
    this.store = new VersionedJsonFileStore(options.filePath, {
      currentVersion: APP_SETTINGS_SCHEMA_VERSION,
      migrations: APP_SETTINGS_MIGRATIONS,
      parse: (value) => {
        const parsed = AppSettingsSchema.safeParse(value)
        if (!parsed.success) {
          throw new Error(`Invalid settings file: ${options.filePath}: ${parsed.error.message}`)
        }
        return parsed.data
      },
    })
    if (!this.store.exists()) {
      this.write(options.initialSettings ?? DEFAULT_APP_SETTINGS)
      return
    }

    if (options.resetInvalidFile) {
      try {
        const parsed = AppSettingsSchema.safeParse(this.store.read())
        if (!parsed.success) {
          this.write(options.initialSettings ?? DEFAULT_APP_SETTINGS)
        }
      }
      catch (error) {
        if (error instanceof UnsupportedJsonSchemaVersionError || error instanceof JsonFileMigrationError) {
          throw error
        }
        this.write(options.initialSettings ?? DEFAULT_APP_SETTINGS)
      }
    }

    // Merge new builtin providers from defaults into existing settings
    this.mergeBuiltinProviders()
  }

  read(): AppSettingsState {
    return this.store.read()
  }

  write(settings: AppSettingsState): AppSettingsState {
    const nextSettings = AppSettingsSchema.parse(settings)
    this.store.write(nextSettings)
    return nextSettings
  }

  update(mutator: (settings: AppSettingsState) => AppSettingsState): AppSettingsState {
    return this.write(mutator(this.read()))
  }

  /**
   * Merge new builtin providers from DEFAULT_APP_SETTINGS into existing settings.
   * Only adds providers that don't exist in user's settings (by id).
   */
  private mergeBuiltinProviders(): void {
    let rawSettings: AppSettingsState
    try {
      rawSettings = this.store.read()
    }
    catch {
      return
    }
    const parsed = AppSettingsSchema.safeParse(rawSettings)
    if (!parsed.success) {
      return
    }
    const currentSettings = parsed.data
    const defaultSettings = this.options.initialSettings ?? DEFAULT_APP_SETTINGS
    const currentProviderIds = new Set(currentSettings.providers.map(p => p.id))

    const newProviders = defaultSettings.providers.filter(
      p => !currentProviderIds.has(p.id),
    )

    if (newProviders.length > 0) {
      this.write({
        ...currentSettings,
        providers: [...currentSettings.providers, ...newProviders],
      })
    }
  }
}
