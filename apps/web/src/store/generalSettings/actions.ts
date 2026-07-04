import type { AppearanceSettingsState, ProxySettings } from '@ant-chat/shared'
import { produce } from 'immer'
import { toast } from 'sonner'
import { generalSettingsApi } from '@/api/generalSettingsApi'
import { migrateLegacyTheme } from '@/utils/themeMigration'
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

export async function setAssistantProviderId(providerId: string) {
  useGeneralSettingsStore.setState(produce((state) => {
    state.isLoading = true
  }))
  try {
    const updates = { assistantProviderId: providerId }
    const newSettings = await generalSettingsApi.updateSettings(updates)
    useGeneralSettingsStore.setState(newSettings)
  }
  finally {
    useGeneralSettingsStore.setState(produce((state) => {
      state.isLoading = false
    }))
  }
}

export async function setAssistantModel(modelId: string, providerId: string) {
  useGeneralSettingsStore.setState(produce((state) => {
    state.isLoading = true
  }))
  try {
    const updates = { assistantModelId: modelId, assistantProviderId: providerId }
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

export async function updateAppearance(appearanceUpdates: Partial<AppearanceSettingsState>) {
  const prevAppearance = useGeneralSettingsStore.getState().appearance

  // 乐观更新
  useGeneralSettingsStore.setState(produce((state) => {
    state.appearance = { ...state.appearance, ...appearanceUpdates }
    state.isLoading = true
  }))

  try {
    const newSettings = await generalSettingsApi.updateSettings({
      appearance: { ...prevAppearance, ...appearanceUpdates },
    })
    useGeneralSettingsStore.setState(produce((state) => {
      state.appearance = newSettings.appearance
      state.isLoading = false
    }))
  }
  catch {
    toast.error('外观设置保存失败')
    // 回滚
    useGeneralSettingsStore.setState(produce((state) => {
      state.appearance = prevAppearance
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
  catch {
    // 服务端不可用时保留当前状态（含缓存主题）
  }
  finally {
    useGeneralSettingsStore.setState(produce((state) => {
      state.isLoading = false
    }))
  }
}

// 初始化时加载设置
export function initializeGeneralSettings() {
  refreshGeneralSettings().then(() => {
    migrateLegacyTheme()
  })
}
