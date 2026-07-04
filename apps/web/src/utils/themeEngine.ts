import type { AppearanceSettingsState } from '@ant-chat/shared'

/**
 * 首帧缓存键名
 */
export const THEME_CACHE_KEY = 'ant-chat:theme-cache'

/**
 * 主题引擎：负责在 DOM 上应用外观配置。
 * 可在 React 启动前独立使用（通过缓存），也可在 React 运行时使用。
 */

/**
 * 计算当前有效的明暗模式。
 * system 模式下返回操作系统偏好，否则直接返回 mode。
 */
export function resolveEffectiveDarkMode(appearance: AppearanceSettingsState): boolean {
  if (appearance.mode === 'system') {
    if (typeof window === 'undefined')
      return false
    return !window.matchMedia('(prefers-color-scheme: light)').matches
  }
  return appearance.mode === 'dark'
}

/**
 * 根据 appearance 配置获取当前有效的主题 ID。
 */
export function resolveEffectiveThemeId(appearance: AppearanceSettingsState): string {
  const isDark = resolveEffectiveDarkMode(appearance)
  return isDark ? appearance.darkThemeId : appearance.lightThemeId
}

/**
 * 检查主题 ID 是否为已知主题。
 * 首个切片只有 'default'。
 */
export function isKnownThemeId(themeId: string): boolean {
  return themeId === 'default'
}

/**
 * 将外观配置应用到 document.documentElement。
 * 设置：
 * - .dark class (根据有效明暗模式)
 * - data-theme 属性 (当前有效主题 ID，未知 ID 降级为 default)
 * - color-scheme CSS 属性
 */
export function applyThemeToDocument(appearance: AppearanceSettingsState): void {
  if (typeof document === 'undefined')
    return

  const root = document.documentElement
  const isDark = resolveEffectiveDarkMode(appearance)
  const rawThemeId = resolveEffectiveThemeId(appearance)
  const themeId = isKnownThemeId(rawThemeId) ? rawThemeId : 'default'

  // 明暗 class
  root.classList.toggle('dark', isDark)

  // 主题属性
  root.setAttribute('data-theme', themeId)

  // color-scheme
  root.style.colorScheme = isDark ? 'dark' : 'light'
}

/**
 * 将当前外观持久化到 localStorage 供首帧使用。
 */
export function cacheAppearance(appearance: AppearanceSettingsState): void {
  try {
    localStorage.setItem(THEME_CACHE_KEY, JSON.stringify(appearance))
  }
  catch {
    // localStorage 不可用时静默忽略
  }
}

/**
 * 从 localStorage 读取缓存的外观配置。
 */
export function getCachedAppearance(): AppearanceSettingsState | null {
  try {
    const raw = localStorage.getItem(THEME_CACHE_KEY)
    if (!raw)
      return null
    return JSON.parse(raw) as AppearanceSettingsState
  }
  catch {
    return null
  }
}

/**
 * 清除首帧缓存。
 */
export function clearCachedAppearance(): void {
  try {
    localStorage.removeItem(THEME_CACHE_KEY)
  }
  catch {
    // 静默忽略
  }
}
