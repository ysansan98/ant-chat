import type { GeneralSettingsState } from '@ant-chat/shared'
import { getAppRpcClient } from './transports/appRpc'

export interface GeneralSettingsAPI {
  getSettings: () => Promise<GeneralSettingsState>
  updateSettings: (updates: Partial<GeneralSettingsState>) => Promise<GeneralSettingsState>
  resetSettings: () => Promise<GeneralSettingsState>
}

export const generalSettingsApi: GeneralSettingsAPI = {
  getSettings: async () => {
    return getAppRpcClient().call('settings.getSettings', undefined)
  },

  updateSettings: async (updates: Partial<GeneralSettingsState>) => {
    return getAppRpcClient().call('settings.updateSettings', { updates })
  },

  resetSettings: async () => {
    return getAppRpcClient().call('settings.resetSettings', undefined)
  },
}
