import type { GeneralSettingsState } from '@ant-chat/shared'
import type { SettingsRepository } from '../../repositories'
import type { AppDataDatabase } from '../types'
import { GeneralSettingsSchema } from '@ant-chat/shared'
import { eq } from 'drizzle-orm'
import { appSettingsTable } from '../schema'

const GENERAL_SETTINGS_KEY = 'general'

const DEFAULT_GENERAL_SETTINGS: GeneralSettingsState = {
  assistantModelId: '',
  proxySettings: {
    mode: 'none',
    customProxyUrl: '',
  },
}

export class SqliteSettingsRepository implements SettingsRepository {
  constructor(private readonly db: AppDataDatabase) {}

  async getGeneralSettings(): Promise<GeneralSettingsState> {
    const result = this.db.select().from(appSettingsTable).where(eq(appSettingsTable.key, GENERAL_SETTINGS_KEY)).get()
    return result ? this.parseStoredSettings(result.value) : DEFAULT_GENERAL_SETTINGS
  }

  parseStoredSettings(value: unknown): GeneralSettingsState {
    return GeneralSettingsSchema.parse(value)
  }

  async updateGeneralSettings(updates: Partial<GeneralSettingsState>): Promise<GeneralSettingsState> {
    const currentSettings = await this.getGeneralSettings()
    const nextSettings: GeneralSettingsState = {
      ...currentSettings,
      ...updates,
      proxySettings: updates.proxySettings
        ? { ...currentSettings.proxySettings, ...updates.proxySettings }
        : currentSettings.proxySettings,
    }

    this.db.insert(appSettingsTable)
      .values({ key: GENERAL_SETTINGS_KEY, value: nextSettings, updatedAt: Date.now() })
      .onConflictDoUpdate({
        target: appSettingsTable.key,
        set: { value: nextSettings, updatedAt: Date.now() },
      })
      .run()

    return nextSettings
  }

  async resetGeneralSettings(): Promise<GeneralSettingsState> {
    this.db.insert(appSettingsTable)
      .values({ key: GENERAL_SETTINGS_KEY, value: DEFAULT_GENERAL_SETTINGS, updatedAt: Date.now() })
      .onConflictDoUpdate({
        target: appSettingsTable.key,
        set: { value: DEFAULT_GENERAL_SETTINGS, updatedAt: Date.now() },
      })
      .run()

    return DEFAULT_GENERAL_SETTINGS
  }
}
