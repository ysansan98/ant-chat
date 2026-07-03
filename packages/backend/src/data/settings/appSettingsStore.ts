import type { AppSettingsState } from '@ant-chat/shared'
import { AppSettingsSchema } from '@ant-chat/shared'
import { JsonFileMigrationError, UnsupportedJsonSchemaVersionError, VersionedJsonFileStore } from '../file'
import { DEFAULT_APP_SETTINGS } from './defaultAppSettings'

const APP_SETTINGS_SCHEMA_VERSION = 1
const APP_SETTINGS_MIGRATIONS = [
  {
    version: 1,
    migrate: (value: unknown) => value,
  },
] as const

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
