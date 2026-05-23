import type { GeneralSettingsState } from '@ant-chat/shared'
import type { SettingsRepository } from '../repositories'

export class SettingsService {
  constructor(private readonly repository: SettingsRepository) {}

  async getGeneralSettings(): Promise<GeneralSettingsState> {
    return this.repository.getGeneralSettings()
  }

  async updateGeneralSettings(updates: Partial<GeneralSettingsState>): Promise<GeneralSettingsState> {
    return this.repository.updateGeneralSettings(updates)
  }

  async resetGeneralSettings(): Promise<GeneralSettingsState> {
    return this.repository.resetGeneralSettings()
  }
}
