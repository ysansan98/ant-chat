import type { GeneralSettingsState } from '@ant-chat/shared'
import { getAppTransport } from './transports/appTransport'

export interface GeneralSettingsAPI {
  getSettings: () => Promise<GeneralSettingsState>
  updateSettings: (updates: Partial<GeneralSettingsState>) => Promise<GeneralSettingsState>
  resetSettings: () => Promise<GeneralSettingsState>
}

export const generalSettingsApi: GeneralSettingsAPI = {
  getSettings: async () => {
    return (await getAppTransport()).settings.getSettings()
  },

  updateSettings: async (updates: Partial<GeneralSettingsState>) => {
    return (await getAppTransport()).settings.updateSettings(updates)
  },

  resetSettings: async () => {
    return (await getAppTransport()).settings.resetSettings()
  },
}
