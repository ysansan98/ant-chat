import type { GeneralSettingsState } from '@ant-chat/shared'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

interface GeneralSettingsStoreState extends GeneralSettingsState {
  isLoading: boolean
}

const DEFAULT_SETTINGS: GeneralSettingsState = {
  assistantModelId: '',
  proxySettings: {
    mode: 'none',
    customProxyUrl: '',
  },
}

export const useGeneralSettingsStore = create<GeneralSettingsStoreState>()(
  devtools(
    _set => ({
      // Initial state
      ...DEFAULT_SETTINGS,
      isLoading: false,
    }),
    {
      name: 'General-Settings',
      enabled: import.meta.env.MODE === 'development',
    },
  ),
)
