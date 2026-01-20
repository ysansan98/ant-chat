import type { GeneralSettingsState } from '@ant-chat/shared'
import { emitter, unwrapIpcResponse } from '@/utils/ipc-bus'

export interface GeneralSettingsAPI {
  getSettings: () => Promise<GeneralSettingsState>
  updateSettings: (updates: Partial<GeneralSettingsState>) => Promise<GeneralSettingsState>
  resetSettings: () => Promise<GeneralSettingsState>
}

export const generalSettingsApi: GeneralSettingsAPI = {
  getSettings: async () => {
    const response = await emitter.invoke('general-settings:get-settings')
    return unwrapIpcResponse(response)
  },

  updateSettings: async (updates: Partial<GeneralSettingsState>) => {
    const response = await emitter.invoke('general-settings:update-settings', updates)
    return unwrapIpcResponse(response)
  },

  resetSettings: async () => {
    const response = await emitter.invoke('general-settings:reset-settings')
    return unwrapIpcResponse(response)
  },
}
