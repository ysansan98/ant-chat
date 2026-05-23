import type { SettingsRepository } from '@ant-chat/app-data'
import type { GeneralSettingsState } from '@ant-chat/shared'
import { getGeneralSettings, resetGeneralSettings, updateGeneralSettings } from '@main/db/services'

export class SqliteSettingsRepository implements SettingsRepository {
  async getGeneralSettings(): Promise<GeneralSettingsState> {
    return getGeneralSettings()
  }

  async updateGeneralSettings(updates: Partial<GeneralSettingsState>): Promise<GeneralSettingsState> {
    return updateGeneralSettings(updates)
  }

  async resetGeneralSettings(): Promise<GeneralSettingsState> {
    return resetGeneralSettings()
  }
}
