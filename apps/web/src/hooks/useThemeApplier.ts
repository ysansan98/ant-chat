import type { AppearanceSettingsState } from '@ant-chat/shared'
import { useEffect, useRef } from 'react'
import { getAppEventBus } from '@/api/transports/appEventBus'
import { useGeneralSettingsStore } from '@/store/generalSettings/store'
import {
  applyThemeToDocument,
  cacheAppearance,
  getCachedAppearance,
  isKnownThemeId,
  resolveEffectiveDarkMode,
  resolveEffectiveThemeId,
} from '@/utils/themeEngine'

/**
 * 在 React 启动前使用本地缓存快速应用首帧主题。
 * 必须在 React 渲染之前调用（如在 main.tsx 入口处）。
 */
export function applyInitialTheme(): void {
  const cached = getCachedAppearance()
  if (cached) {
    applyThemeToDocument(cached)
  }
}

/**
 * React Hook: 监听外观配置变化并实时应用到 DOM。
 * 处理：
 * - 服务端配置变化后校准
 * - settings:updated 事件同步（跨窗口）
 * - 系统 mode=system 时 OS 明暗变化
 */
export function useThemeApplier(): void {
  const appearance = useGeneralSettingsStore(state => state.appearance)
  const serverSettingsLoaded = useRef(false)

  // 服务端配置加载后，用服务端值校准并更新缓存
  useEffect(() => {
    // 跳过首次渲染，保留首帧缓存的本地主题；等待服务端数据到达后校准
    if (!serverSettingsLoaded.current) {
      serverSettingsLoaded.current = true
      return
    }

    // updateAppearance 已在 store 更新前同步调用了 applyThemeToDocument，
    // 如果 DOM 已与应用一致则跳过，避免二次调用的 no-transition 打断过渡动画
    const root = document.documentElement
    const isDark = resolveEffectiveDarkMode(appearance)
    const rawThemeId = resolveEffectiveThemeId(appearance)
    const themeId = isKnownThemeId(rawThemeId) ? rawThemeId : 'default'

    if (root.classList.contains('dark') === isDark && (root.getAttribute('data-theme') || 'default') === themeId) {
      return
    }

    applyThemeToDocument(appearance)
    cacheAppearance(appearance)
  }, [appearance])

  // 监听 settings:updated 事件（跨窗口同步）
  useEffect(() => {
    const bus = getAppEventBus()

    const handleSettingsUpdated = (_event: unknown, payload: { keys: string[] }) => {
      if (!payload.keys.includes('appearance') && !payload.keys.includes('all'))
        return

      // 重新从 store 读取当前值（可能已被其他窗口更新）
      const currentAppearance = useGeneralSettingsStore.getState().appearance
      applyThemeToDocument(currentAppearance)
      cacheAppearance(currentAppearance)
    }

    bus.on('settings:updated', handleSettingsUpdated)
    return () => {
      bus.removeListener('settings:updated', handleSettingsUpdated)
    }
  }, [])

  // 监听系统色彩方案变化（仅对 system 模式生效）
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: light)')

    const handleChange = () => {
      const currentAppearance = useGeneralSettingsStore.getState().appearance
      if (currentAppearance.mode === 'system') {
        applyThemeToDocument(currentAppearance)
        cacheAppearance(currentAppearance)
      }
    }

    mediaQuery.addEventListener('change', handleChange)
    return () => {
      mediaQuery.removeEventListener('change', handleChange)
    }
  }, [])
}

/**
 * 便捷 hook：返回当前主题引擎状态。
 */
export function useThemeState(): {
  appearance: AppearanceSettingsState
  isDark: boolean
  effectiveThemeId: string
} {
  const appearance = useGeneralSettingsStore(state => state.appearance)
  const isDark = resolveEffectiveDarkMode(appearance)
  const rawThemeId = resolveEffectiveThemeId(appearance)
  const effectiveThemeId = isKnownThemeId(rawThemeId) ? rawThemeId : 'default'

  return { appearance, isDark, effectiveThemeId }
}
