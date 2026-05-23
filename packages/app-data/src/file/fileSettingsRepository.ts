import type { GeneralSettingsState } from '@ant-chat/shared'
import type { SettingsRepository } from '../repositories'
import { GeneralSettingsSchema } from '@ant-chat/shared'
import { AtomicJsonFileStore } from './atomicJsonFileStore'

export const DEFAULT_GENERAL_SETTINGS: GeneralSettingsState = {
  assistantModelId: '',
  proxySettings: {
    mode: 'none',
    customProxyUrl: '',
  },
}

export interface FileSettingsRepositoryOptions {
  filePath: string
  initialSettings?: GeneralSettingsState
}

export class FileSettingsRepository implements SettingsRepository {
  private readonly store: AtomicJsonFileStore<GeneralSettingsState>
  private readonly filePath: string

  constructor(options: FileSettingsRepositoryOptions) {
    this.filePath = options.filePath
    this.store = new AtomicJsonFileStore(options.filePath)
    if (!this.store.exists()) {
      this.store.write(options.initialSettings ?? DEFAULT_GENERAL_SETTINGS)
    }
  }

  async getGeneralSettings(): Promise<GeneralSettingsState> {
    const parsed = GeneralSettingsSchema.safeParse(this.store.read())
    if (!parsed.success) {
      throw new Error(`Invalid settings file: ${this.filePath}: ${parsed.error.message}`)
    }
    return parsed.data
  }

  async updateGeneralSettings(updates: Partial<GeneralSettingsState>): Promise<GeneralSettingsState> {
    const currentSettings = await this.getGeneralSettings()
    const nextSettings = GeneralSettingsSchema.parse({
      ...currentSettings,
      ...updates,
      proxySettings: updates.proxySettings
        ? { ...currentSettings.proxySettings, ...updates.proxySettings }
        : currentSettings.proxySettings,
    })
    this.store.write(nextSettings)
    return nextSettings
  }

  async resetGeneralSettings(): Promise<GeneralSettingsState> {
    this.store.write(DEFAULT_GENERAL_SETTINGS)
    return DEFAULT_GENERAL_SETTINGS
  }
}
