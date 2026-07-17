import type { AppearanceSettingsState, ProxySettings, ReasoningEffortLevel } from '@ant-chat/shared'
import { produce } from 'immer'
import { toast } from 'sonner'
import { generalSettingsApi } from '@/api/generalSettingsApi'
import { applyThemeToDocument, cacheAppearance } from '@/utils/themeEngine'
import { migrateLegacyTheme } from '@/utils/themeMigration'
import { useGeneralSettingsStore } from './store'

// 跳过下一轮 refreshGeneralSettings（当前窗口刚更新完，不需要再 GET）
let _skipNextRefresh = false
export function skipNextSettingsRefresh() {
  _skipNextRefresh = true
}

export async function setAutoGenerateTitle(autoGenerateTitle: boolean) {
  useGeneralSettingsStore.setState(produce((state) => {
    state.isLoading = true
  }))
  try {
    const updates = { autoGenerateTitle }
    const newSettings = await generalSettingsApi.updateSettings(updates)
    useGeneralSettingsStore.setState(newSettings)
  }
  finally {
    useGeneralSettingsStore.setState(produce((state) => {
      state.isLoading = false
    }))
  }
}

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

export async function setAssistantReasoningEffort(reasoningEffort: ReasoningEffortLevel | undefined) {
  useGeneralSettingsStore.setState(produce((state) => {
    state.isLoading = true
  }))
  try {
    const updates = { reasoningEffort }
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

  // 值没有实际变化则跳过，避免重复点击触发无意义的 API 调用和重渲染
  let hasChanges = false
  for (const key of Object.keys(appearanceUpdates) as (keyof AppearanceSettingsState)[]) {
    if (prevAppearance[key] !== appearanceUpdates[key]) {
      hasChanges = true
      break
    }
  }
  if (!hasChanges)
    return

  const nextAppearance = { ...prevAppearance, ...appearanceUpdates }

  // 同步应用主题到 DOM，确保 CSS 变量在 React 重渲染前更新，
  // 避免按钮 class 变动与 CSS 变量更新时机不一致导致的页面抖动
  applyThemeToDocument(nextAppearance)
  cacheAppearance(nextAppearance)

  // 乐观更新（不设 isLoading，外观切换无加载态，避免 disabled 导致闪烁）
  useGeneralSettingsStore.setState(produce((state) => {
    state.appearance = nextAppearance
  }))

  try {
    const newSettings = await generalSettingsApi.updateSettings({
      appearance: { ...prevAppearance, ...appearanceUpdates },
    })

    // 如果服务器确认值和当前乐观值一致，保留引用避免不必要的重渲染
    const currentAppearance = useGeneralSettingsStore.getState().appearance
    const isSameAppearance = (
      currentAppearance.mode === newSettings.appearance.mode
      && currentAppearance.lightThemeId === newSettings.appearance.lightThemeId
      && currentAppearance.darkThemeId === newSettings.appearance.darkThemeId
    )

    if (!isSameAppearance) {
      useGeneralSettingsStore.setState(produce((state) => {
        state.appearance = newSettings.appearance
      }))
    }
  }
  catch {
    toast.error('外观设置保存失败')
    // 回滚
    useGeneralSettingsStore.setState(produce((state) => {
      state.appearance = prevAppearance
    }))
    applyThemeToDocument(prevAppearance)
    cacheAppearance(prevAppearance)
  }
}

export async function resetGeneralSettings() {
  useGeneralSettingsStore.setState(produce((state) => {
    state.isLoading = true
  }))
  try {
    const newSettings = await generalSettingsApi.resetSettings()

    // 保留当前 appearance 引用避免不必要重渲染
    const state = useGeneralSettingsStore.getState()
    const isSameAppearance = (
      state.appearance.mode === newSettings.appearance.mode
      && state.appearance.lightThemeId === newSettings.appearance.lightThemeId
      && state.appearance.darkThemeId === newSettings.appearance.darkThemeId
    )

    useGeneralSettingsStore.setState({
      ...newSettings,
      appearance: isSameAppearance ? state.appearance : newSettings.appearance,
    })
  }
  finally {
    useGeneralSettingsStore.setState(produce((state) => {
      state.isLoading = false
    }))
  }
}

export async function refreshGeneralSettings() {
  // 当前窗口刚完成 updateSettings（已返回完整数据），跳过不必要的 GET
  if (_skipNextRefresh) {
    _skipNextRefresh = false
    return
  }

  useGeneralSettingsStore.setState(produce((state) => {
    state.isLoading = true
  }))
  try {
    const newSettings = await generalSettingsApi.getSettings()

    // 如果数据和当前已缓存的一致，保留对象引用避免不必要重渲染
    const state = useGeneralSettingsStore.getState()
    const isSameAppearance = (
      state.appearance.mode === newSettings.appearance.mode
      && state.appearance.lightThemeId === newSettings.appearance.lightThemeId
      && state.appearance.darkThemeId === newSettings.appearance.darkThemeId
    )

    useGeneralSettingsStore.setState({
      ...newSettings,
      appearance: isSameAppearance ? state.appearance : newSettings.appearance,
    })
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
