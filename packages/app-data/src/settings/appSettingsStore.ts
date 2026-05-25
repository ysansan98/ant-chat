import type { AppSettingsState } from '@ant-chat/shared'
import { AppSettingsSchema } from '@ant-chat/shared'
import { AtomicJsonFileStore } from '../file'
import { DEFAULT_APP_SETTINGS } from './defaultAppSettings'

export interface AppSettingsStoreOptions {
  filePath: string
  initialSettings?: AppSettingsState
  resetInvalidFile?: boolean
}

export class AppSettingsStore {
  private readonly store: AtomicJsonFileStore<AppSettingsState>

  constructor(private readonly options: AppSettingsStoreOptions) {
    this.store = new AtomicJsonFileStore(options.filePath)
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
      catch {
        this.write(options.initialSettings ?? DEFAULT_APP_SETTINGS)
      }
    }
  }

  read(): AppSettingsState {
    const parsed = AppSettingsSchema.safeParse(this.store.read())
    if (!parsed.success) {
      throw new Error(`Invalid settings file: ${this.options.filePath}: ${parsed.error.message}`)
    }
    return parsed.data
  }

  write(settings: AppSettingsState): AppSettingsState {
    const nextSettings = AppSettingsSchema.parse(settings)
    this.store.write(nextSettings)
    return nextSettings
  }

  update(mutator: (settings: AppSettingsState) => AppSettingsState): AppSettingsState {
    return this.write(mutator(this.read()))
  }
}
