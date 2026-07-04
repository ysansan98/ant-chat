import type { AppearanceSettingsState } from '@ant-chat/shared'
import { generalSettingsApi } from '@/api/generalSettingsApi'
import { useGeneralSettingsStore } from '@/store/generalSettings/store'

/**
 * 旧主题 store 的 localStorage key（zustand persist）。
 */
const OLD_THEME_STORE_KEY = 'theme'

/**
 * 迁移标记 key
 */
const MIGRATION_MARKER_KEY = 'ant-chat:theme-migration-v1'

/**
 * 旧主题 store 的接口定义
 */
interface OldThemeStore {
  state: {
    mode: 'auto' | 'dark' | 'light'
    theme: 'dark' | 'light'
  }
  version: number
}

/**
 * 一次性迁移旧主题配置到新的外观配置。
 *
 * 流程：
 * 1. 检查是否已迁移（通过 localStorage 标记）
 * 2. 检查服务端是否已有外观配置（有则跳过）
 * 3. 从 localStorage 读取旧主题配置
 * 4. 转换为新外观配置格式
 * 5. 通过 API 保存到服务端
 * 6. 清除旧 localStorage 数据并标记迁移完成
 */
export async function migrateLegacyTheme(): Promise<void> {
  // 已迁移过则跳过
  if (localStorage.getItem(MIGRATION_MARKER_KEY))
    return

  // 读取旧主题配置
  try {
    const raw = localStorage.getItem(OLD_THEME_STORE_KEY)
    if (!raw) {
      localStorage.setItem(MIGRATION_MARKER_KEY, 'done')
      return
    }

    const oldStore: OldThemeStore = JSON.parse(raw)
    if (!oldStore?.state?.mode) {
      localStorage.setItem(MIGRATION_MARKER_KEY, 'done')
      return
    }

    // 转换模式：auto → system
    const modeMap: Record<string, AppearanceSettingsState['mode']> = {
      auto: 'system',
      dark: 'dark',
      light: 'light',
    }

    const appearance: AppearanceSettingsState = {
      mode: modeMap[oldStore.state.mode] ?? 'system',
      lightThemeId: 'default',
      darkThemeId: 'default',
    }

    // 保存到服务端
    await generalSettingsApi.updateSettings({ appearance })

    // 更新本地 store
    useGeneralSettingsStore.setState(state => ({
      ...state,
      appearance,
    }))

    // 清理旧数据
    try {
      localStorage.removeItem(OLD_THEME_STORE_KEY)
    }
    catch {
      // 静默忽略
    }

    // 标记迁移完成
    localStorage.setItem(MIGRATION_MARKER_KEY, 'done')
  }
  catch {
    // 迁移失败时静默处理，下次启动会重试
    console.warn('[ThemeMigration] 旧主题配置迁移失败，下次启动将重试')
  }
}
