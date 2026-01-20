import type { GeneralSettingsState } from '@ant-chat/shared'
import Store from 'electron-store'

const DEFAULT_SETTINGS: GeneralSettingsState = {
  assistantModelId: '',
  proxySettings: {
    mode: 'none',
    customProxyUrl: '',
  },
}

const schema = {
  generalSettings: {
    type: 'object' as const,
    properties: {
      assistantModelId: {
        type: 'string' as const,
        default: '',
      },
      proxySettings: {
        type: 'object' as const,
        properties: {
          mode: {
            type: 'string' as const,
            enum: ['none', 'system', 'custom'],
            default: 'none',
          },
          customProxyUrl: {
            type: 'string' as const,
            default: '',
          },
        },
        required: ['mode'],
      },
    },
    required: ['assistantModelId', 'proxySettings'],
  },
}

console.error('schema', schema, Store)

export class GeneralSettingsStore {
  private static instance: GeneralSettingsStore
  private store = new Store({ schema })

  static getInstance(): GeneralSettingsStore {
    if (!GeneralSettingsStore.instance) {
      GeneralSettingsStore.instance = new GeneralSettingsStore()
    }
    return GeneralSettingsStore.instance
  }

  getSettings(): GeneralSettingsState {
    return this.store.get('generalSettings', DEFAULT_SETTINGS) as GeneralSettingsState
  }

  updateSettings(updates: Partial<GeneralSettingsState>): void {
    const currentSettings = this.getSettings()
    const newSettings = { ...currentSettings, ...updates }
    this.store.set('generalSettings', newSettings)
  }

  resetSettings(): void {
    this.store.set('generalSettings', DEFAULT_SETTINGS)
  }
}
