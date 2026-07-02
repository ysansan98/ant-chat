import type { GeneralSettingsState } from '@ant-chat/shared'

export interface SettingsRepository {
  getGeneralSettings: () => Promise<GeneralSettingsState>
  updateGeneralSettings: (updates: Partial<GeneralSettingsState>) => Promise<GeneralSettingsState>
  resetGeneralSettings: () => Promise<GeneralSettingsState>
}
