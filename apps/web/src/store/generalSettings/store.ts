import type { GeneralSettingsState } from '@ant-chat/shared'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

interface GeneralSettingsStoreState extends GeneralSettingsState {
  isLoading: boolean
}

const DEFAULT_SETTINGS: GeneralSettingsState = {
  assistantModelId: '',
  assistantProviderId: '',
  autoGenerateTitle: false,
  proxySettings: {
    mode: 'none',
    customProxyUrl: '',
  },
  appearance: {
    mode: 'system',
    lightThemeId: 'default',
    darkThemeId: 'default',
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
