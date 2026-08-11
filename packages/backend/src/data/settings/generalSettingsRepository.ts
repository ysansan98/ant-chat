import type { GeneralSettingsState } from '@ant-chat/shared'
import type { SettingsRepository } from '../repositories'
import { GeneralSettingsSchema } from '@ant-chat/shared'
import { AppSettingsStore } from './appSettingsStore'

export const DEFAULT_GENERAL_SETTINGS: GeneralSettingsState = {
  assistantModelId: '',
  assistantProviderId: '',
  visionModelId: '',
  visionProviderId: '',
  defaultModelId: '',
  defaultProviderId: '',
  autoGenerateTitle: false,
  reasoningEffort: undefined,
  proxySettings: {
    mode: 'none',
    customProxyUrl: '',
  },
  appearance: {
    mode: 'system',
    lightThemeId: 'default',
    darkThemeId: 'default',
  },
  developerTools: {
    agentObservabilityEnabled: false,
  },
}

export interface GeneralSettingsRepositoryOptions {
  filePath: string
  initialSettings?: GeneralSettingsState
  store?: AppSettingsStore
}

export class GeneralSettingsRepository implements SettingsRepository {
  private readonly store: AppSettingsStore

  constructor(options: GeneralSettingsRepositoryOptions) {
    this.store = options.store ?? new AppSettingsStore({
      filePath: options.filePath,
      initialSettings: options.initialSettings
        ? { ...options.initialSettings, providers: [] }
        : undefined,
    })
  }

  async getGeneralSettings(): Promise<GeneralSettingsState> {
    const parsed = GeneralSettingsSchema.safeParse(this.store.read())
    if (!parsed.success) {
      throw new Error(`Invalid general settings: ${parsed.error.message}`)
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
      appearance: updates.appearance
        ? { ...currentSettings.appearance, ...updates.appearance }
        : currentSettings.appearance,
      developerTools: updates.developerTools
        ? { ...currentSettings.developerTools, ...updates.developerTools }
        : currentSettings.developerTools,
    })
    this.store.update(settings => ({ ...settings, ...nextSettings }))
    return nextSettings
  }

  async resetGeneralSettings(): Promise<GeneralSettingsState> {
    this.store.update(settings => ({ ...settings, ...DEFAULT_GENERAL_SETTINGS }))
    return DEFAULT_GENERAL_SETTINGS
  }
}
