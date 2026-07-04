import type { AppearanceSettingsState } from '@ant-chat/shared'
import { CloudSunIcon, MoonIcon, SunIcon } from 'lucide-react'
import { updateAppearance } from '@/store/generalSettings/actions'
import { useGeneralSettingsStore } from '@/store/generalSettings/store'
import { SettingsPageHeader } from './SettingsPageHeader'

const modeOptions = [
  { id: 'system' as const, label: '跟随系统', icon: CloudSunIcon, description: '根据操作系统自动切换明暗' },
  { id: 'light' as const, label: '亮色', icon: SunIcon, description: '始终使用亮色主题' },
  { id: 'dark' as const, label: '暗色', icon: MoonIcon, description: '始终使用暗色主题' },
]

const themeOptions = [
  { id: 'default', label: '默认主题' },
  {
    id: 'airbnb',
    label: 'Airbnb 灵感',
    subtitle: '非官方',
    colors: ['oklch(0.44 0.2 17)', 'oklch(0.99 0.003 85)', 'oklch(0.28 0.01 90)'],
  },
]

/** Airbnb 主题预览色圆点 */
function ThemePreviewDot({ color }: { color: string }) {
  return (
    <span
      className="inline-block size-3 rounded-full border border-border/50"
      style={{ backgroundColor: color }}
    />
  )
}

export function AppearanceSettings() {
  const appearance = useGeneralSettingsStore(state => state.appearance)
  const isLoading = useGeneralSettingsStore(state => state.isLoading)

  const handleModeChange = async (mode: AppearanceSettingsState['mode']) => {
    await updateAppearance({ mode })
  }

  const handleLightThemeChange = async (lightThemeId: string) => {
    await updateAppearance({ lightThemeId })
  }

  const handleDarkThemeChange = async (darkThemeId: string) => {
    await updateAppearance({ darkThemeId })
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <SettingsPageHeader
        title="外观"
        description="配置应用主题和明暗模式。"
      />

      <div className="flex flex-col gap-4">
        {/* 明暗模式选择 */}
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">明暗模式</h3>
          {isLoading && <p className="text-xs text-muted-foreground">保存中...</p>}
          <div className="flex flex-wrap gap-3">
            {modeOptions.map(option => (
              <button
                key={option.id}
                type="button"
                disabled={isLoading}
                data-active={appearance.mode === option.id}
                className={`
                  flex flex-col items-center gap-2 rounded-xl border px-6 py-4 text-sm
                  transition-all duration-150
                  ${appearance.mode === option.id
                ? 'border-ring bg-accent/10 shadow-sm'
                : 'border-border hover:border-ring/50 hover:bg-muted/30'
              }
                  disabled:opacity-50
                `}
                onClick={() => handleModeChange(option.id)}
              >
                <option.icon className={`size-6 ${appearance.mode === option.id ? 'text-accent' : 'text-muted-foreground'}`} />
                <div className="flex flex-col items-center gap-0.5">
                  <span className="font-medium">{option.label}</span>
                  <span className="text-xs text-muted-foreground">{option.description}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* 亮色主题选择 */}
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">亮色主题</h3>
          <p className="text-xs text-muted-foreground">在亮色模式下使用的主题</p>
          <div className="flex flex-wrap gap-2">
            {themeOptions.map(theme => (
              <button
                key={theme.id}
                type="button"
                disabled={isLoading}
                data-active={appearance.lightThemeId === theme.id}
                className={`
                  rounded-lg border px-4 py-2 text-sm transition-all duration-150 flex items-center gap-2
                  ${appearance.lightThemeId === theme.id
                ? 'border-ring bg-accent/10 shadow-sm font-medium'
                : 'border-border hover:border-ring/50 hover:bg-muted/30'
              }
                  disabled:opacity-50
                `}
                onClick={() => handleLightThemeChange(theme.id)}
              >
                {theme.colors && (
                  <span className="flex -space-x-1">
                    {theme.colors.map(c => <ThemePreviewDot key={c} color={c} />)}
                  </span>
                )}
                <span>{theme.label}</span>
                {theme.subtitle && (
                  <span className="text-[10px] text-muted-foreground">{theme.subtitle}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* 暗色主题选择 */}
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">暗色主题</h3>
          <p className="text-xs text-muted-foreground">在暗色模式下使用的主题</p>
          <div className="flex flex-wrap gap-2">
            {themeOptions.map(theme => (
              <button
                key={theme.id}
                type="button"
                disabled={isLoading}
                data-active={appearance.darkThemeId === theme.id}
                className={`
                  rounded-lg border px-4 py-2 text-sm transition-all duration-150 flex items-center gap-2
                  ${appearance.darkThemeId === theme.id
                ? 'border-ring bg-accent/10 shadow-sm font-medium'
                : 'border-border hover:border-ring/50 hover:bg-muted/30'
              }
                  disabled:opacity-50
                `}
                onClick={() => handleDarkThemeChange(theme.id)}
              >
                {theme.colors && (
                  <span className="flex -space-x-1">
                    {theme.colors.map(c => <ThemePreviewDot key={c} color={c} />)}
                  </span>
                )}
                <span>{theme.label}</span>
                {theme.subtitle && (
                  <span className="text-[10px] text-muted-foreground">{theme.subtitle}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
