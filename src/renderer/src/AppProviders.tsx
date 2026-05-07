import type { ReactNode } from 'react'
import { TooltipProvider } from '@workspace/ui/components/tooltip'
import { App, ConfigProvider, theme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { useEffect } from 'react'
import { initializeGeneralSettings } from '@/store/generalSettings/actions'
import { useThemeStore } from '@/store/theme'

interface AppProvidersProps {
  children: ReactNode
}

export function AppProviders({ children }: AppProvidersProps) {
  const currentThemeMode = useThemeStore(state => state.mode)
  const currentTheme = useThemeStore(state => state.theme)
  const toggleTheme = useThemeStore(state => state.toggleTheme)

  const algorithm = currentTheme === 'dark'
    ? theme.darkAlgorithm
    : theme.defaultAlgorithm

  useEffect(() => {
    const themeMedia = window.matchMedia('(prefers-color-scheme: light)')
    const handleThemeChange = (event: MediaQueryListEvent | MediaQueryList) => {
      if (currentThemeMode === 'auto') {
        toggleTheme(event.matches ? 'light' : 'dark')
      }
    }

    document.documentElement.classList.toggle('dark', currentTheme === 'dark')
    handleThemeChange(themeMedia)

    themeMedia.addEventListener('change', handleThemeChange)

    return () => {
      themeMedia.removeEventListener('change', handleThemeChange)
    }
  }, [currentTheme, currentThemeMode, toggleTheme])

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
          {children}
        </App>
      </TooltipProvider>
    </ConfigProvider>
  )
}
