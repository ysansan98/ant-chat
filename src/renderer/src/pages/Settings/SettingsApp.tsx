import { TooltipProvider } from '@workspace/ui/components/tooltip'
import { App, ConfigProvider, theme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { useEffect } from 'react'
import { Outlet } from 'react-router'
import { initializeGeneralSettings } from '@/store/generalSettings/actions'
import { useThemeStore } from '@/store/theme'
import { useIpcEventListener } from '@/hooks/useIpcEventListener'

function SettingsApp() {
  useIpcEventListener()
  const currentThemeMode = useThemeStore(state => state.mode)
  const currentTheme = useThemeStore(state => state.theme)
  const toggleTheme = useThemeStore(state => state.toggleTheme)

  const algorithm = currentTheme === 'dark'
    ? theme.darkAlgorithm
    : theme.defaultAlgorithm

  /**
   * 添加浏览器主题变化监听
   */
  useEffect(() => {
    const handleThemeChange = (e: MediaQueryListEvent | MediaQueryList) => {
      if (currentThemeMode === 'auto') {
        const theme = e.matches ? 'light' : 'dark'
        toggleTheme(theme)
      }
    }

    // 同步设置下tailwindcss的暗黑模式
    document.documentElement.classList.toggle('dark', currentTheme === 'dark')

    const themeMedia = window.matchMedia('(prefers-color-scheme: light)')
    handleThemeChange(themeMedia)

    themeMedia.addEventListener('change', handleThemeChange)

    return () => {
      themeMedia.removeEventListener('change', handleThemeChange)
    }
  }, [toggleTheme])

  // 初始化 GeneralSettings
  useEffect(() => {
    initializeGeneralSettings()
  }, [])

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm,
        cssVar: { key: 'antd-css-var' },
        hashed: false,
      }}
    >
      <TooltipProvider>
        <App className="h-full">
          <div className="flex h-dvh w-full overflow-hidden">
            <div className="app-region-drag absolute top-0 left-0 z-9999 h-4 w-full"></div>
            <div className="h-dvh min-w-0 flex-1">
              <Outlet />
            </div>
          </div>
        </App>
      </TooltipProvider>
    </ConfigProvider>
  )
}

export default SettingsApp
