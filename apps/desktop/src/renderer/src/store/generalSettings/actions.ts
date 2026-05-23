import type { ProxySettings } from '@ant-chat/shared'
import { produce } from 'immer'
import { generalSettingsApi } from '@/api/generalSettingsApi'
import { useGeneralSettingsStore } from './store'

export async function setAssistantModelId(id: string) {
  useGeneralSettingsStore.setState(produce((state) => {
    state.isLoading = true
  }))
  try {
    const updates = { assistantModelId: id }
    const newSettings = await generalSettingsApi.updateSettings(updates)
    useGeneralSettingsStore.setState(newSettings)
  }
  finally {
    useGeneralSettingsStore.setState(produce((state) => {
      state.isLoading = false
    }))
  }
}

export async function updateProxySettings(proxySettingsUpdates: Partial<ProxySettings>) {
  useGeneralSettingsStore.setState(produce((state) => {
    state.isLoading = true
  }))
  try {
    const currentSettings = useGeneralSettingsStore.getState()
    const updatedProxySettings = { ...currentSettings.proxySettings, ...proxySettingsUpdates }
    const newSettings = await generalSettingsApi.updateSettings({ proxySettings: updatedProxySettings })
    useGeneralSettingsStore.setState(newSettings)
  }
  finally {
    useGeneralSettingsStore.setState(produce((state) => {
      state.isLoading = false
    }))
  }
}

export async function resetGeneralSettings() {
  useGeneralSettingsStore.setState(produce((state) => {
    state.isLoading = true
  }))
  try {
    const newSettings = await generalSettingsApi.resetSettings()
    useGeneralSettingsStore.setState(newSettings)
  }
  finally {
    useGeneralSettingsStore.setState(produce((state) => {
      state.isLoading = false
    }))
  }
}

export async function refreshGeneralSettings() {
  useGeneralSettingsStore.setState(produce((state) => {
    state.isLoading = true
  }))
  try {
    const newSettings = await generalSettingsApi.getSettings()
    useGeneralSettingsStore.setState(newSettings)
  }
  finally {
    useGeneralSettingsStore.setState(produce((state) => {
      state.isLoading = false
    }))
  }
}

// 初始化时加载设置
export function initializeGeneralSettings() {
  refreshGeneralSettings()
}
