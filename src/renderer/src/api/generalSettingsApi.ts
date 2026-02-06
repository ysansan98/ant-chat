import type { GeneralSettingsState } from '@ant-chat/shared'
import { ipc, unwrapIpcResponse } from '@/utils/ipc-bus'

export interface GeneralSettingsAPI {
  getSettings: () => Promise<GeneralSettingsState>
  updateSettings: (updates: Partial<GeneralSettingsState>) => Promise<GeneralSettingsState>
  resetSettings: () => Promise<GeneralSettingsState>
}

export const generalSettingsApi: GeneralSettingsAPI = {
  getSettings: async () => {
    return unwrapIpcResponse(await ipc.settings.getSettings())
  },

  updateSettings: async (updates: Partial<GeneralSettingsState>) => {
    return unwrapIpcResponse(await ipc.settings.updateSettings(updates))
  },

  resetSettings: async () => {
    return unwrapIpcResponse(await ipc.settings.resetSettings())
  },
}
