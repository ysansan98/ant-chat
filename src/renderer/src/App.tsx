import { App, ConfigProvider, theme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { useEffect } from 'react'
import { Outlet } from 'react-router'
import { initializeGeneralSettings } from '@/store/generalSettings/actions'
import { useThemeStore } from '@/store/theme'
import { AppBar } from './components/AppBar'
import { RunnerCodeProvider } from './components/RunnerCode'
import { SliderMenu } from './components/SiliderMenu'
import { UpdateNotification } from './components/UpdateNotification'
import { useIpcEventListener } from './hooks/useIpcEventListener'
import { useUpdateNotification } from './hooks/useUpdateNotification'

function AppWrapper() {
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

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm,
        cssVar: { key: 'antd-css-var' },
        hashed: false,
      }}
    >
      <RunnerCodeProvider>
        <App className="h-full">
          <AntChatApp />
        </App>
      </RunnerCodeProvider>
    </ConfigProvider>
  )
}

function AntChatApp() {
  useIpcEventListener()
  const { updateInfo, showNotification, hideNotification } = useUpdateNotification()

  // 初始化 GeneralSettings
  useEffect(() => {
    initializeGeneralSettings()
  }, [])

  return (
    <div className={`
      flex h-dvh w-full flex-col overflow-hidden bg-white
      dark:bg-black
    `}
    >
      <div className="shrink-0">
        <AppBar />
      </div>
      <div className="grid h-(--mainHeight) w-full grid-cols-[max-content_1fr]">
        <SliderMenu />
        <Outlet />
      </div>

      {/* 更新通知 */}
      {updateInfo && (
        <UpdateNotification
          updateInfo={updateInfo}
          visible={showNotification}
          onClose={hideNotification}
        />
      )}
    </div>
  )
}

export default AppWrapper
