import type { AppearanceSettingsState } from '@ant-chat/shared'
import { CloudSunIcon, MoonIcon, SunIcon } from 'lucide-react'
import { updateAppearance } from '@/store/generalSettings/actions'
import { useGeneralSettingsStore } from '@/store/generalSettings/store'
import { SettingsPageLayout } from './SettingsPageLayout'

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
    colors: ['oklch(0.6579 0.2309 17.07)', 'oklch(1 0 0)', 'oklch(0.252 0 0)'],
  },
  {
    id: 'cursor',
    label: 'Cursor 灵感',
    subtitle: '非官方',
    colors: ['oklch(0.652 0.213 38)', 'oklch(0.975 0.004 107)', 'oklch(0.20 0.015 95)'],
  },
]

function ThemePreviewDot({ color }: { color: string }) {
  return (
    <span
      className="inline-block size-3 rounded-full border border-border/50"
      style={{ backgroundColor: color }}
    />
  )
}

/** 单选指示器：空心/实心圆点 */
function RadioIndicator({ selected }: { selected: boolean }) {
  return (
    <span
      className={`
        inline-flex size-4.5 shrink-0 items-center justify-center rounded-full border transition-colors
        ${selected ? 'border-foreground' : 'border-border'}
      `}
    >
      {selected && <span className="size-2.5 rounded-full bg-foreground" />}
    </span>
  )
}

export function AppearanceSettings() {
  const appearance = useGeneralSettingsStore(state => state.appearance)

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
    <SettingsPageLayout
      title="外观"
      description="配置应用主题和明暗模式。"
      variant="narrow"
    >
      <div className="flex flex-col gap-6">
        {/* 明暗模式（保留卡片式选择器 —— 3 个视觉效果差异大的选项） */}
        <section>
          <h3 className="mb-2 text-xs font-semibold text-muted-foreground">明暗模式</h3>
          <div className="flex flex-wrap gap-3">
            {modeOptions.map(option => (
              <button
                key={option.id}
                type="button"
                className={`
                  flex cursor-pointer flex-col items-center gap-2 rounded-xl border px-6 py-4
                  text-sm transition-colors duration-150
                  ${appearance.mode === option.id
                ? 'border-ring bg-accent/10'
                : 'border-border hover:border-ring/50 hover:bg-muted/30'
              }
                `}
                onClick={() => handleModeChange(option.id)}
              >
                <option.icon
                  className={`size-6 ${appearance.mode === option.id ? 'text-primary' : 'text-muted-foreground'}`}
                />
                <div className="flex flex-col items-center gap-0.5">
                  <span className="font-medium">{option.label}</span>
                  <span className="text-xs text-muted-foreground">{option.description}</span>
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* 亮色主题（单选 radio 行） */}
        <section>
          <h3 className="mb-2 text-xs font-semibold text-muted-foreground">亮色主题</h3>
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            {themeOptions.map((theme) => {
              const selected = appearance.lightThemeId === theme.id
              return (
                <button
                  key={theme.id}
                  type="button"
                  className={`
                    flex w-full cursor-pointer items-center justify-between gap-3 border-t border-border px-4 py-3
                    text-left first:border-t-0 hover:bg-muted/30
                    ${selected ? 'bg-muted/30' : ''}
                  `}
                  onClick={() => handleLightThemeChange(theme.id)}
                >
                  <span className="flex items-center gap-2 text-sm">
                    {theme.colors && (
                      <span className="flex -space-x-1">
                        {theme.colors.map(c => <ThemePreviewDot key={c} color={c} />)}
                      </span>
                    )}
                    <span className={selected ? 'font-medium' : ''}>{theme.label}</span>
                    {theme.subtitle
                      ? <span className="text-[11px] text-muted-foreground">{theme.subtitle}</span>
                      : null}
                  </span>
                  <RadioIndicator selected={selected} />
                </button>
              )
            })}
          </div>
        </section>

        {/* 暗色主题（单选 radio 行） */}
        <section>
          <h3 className="mb-2 text-xs font-semibold text-muted-foreground">暗色主题</h3>
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            {themeOptions.map((theme) => {
              const selected = appearance.darkThemeId === theme.id
              return (
                <button
                  key={theme.id}
                  type="button"
                  className={`
                    flex w-full cursor-pointer items-center justify-between gap-3 border-t border-border px-4 py-3
                    text-left first:border-t-0 hover:bg-muted/30
                    ${selected ? 'bg-muted/30' : ''}
                  `}
                  onClick={() => handleDarkThemeChange(theme.id)}
                >
                  <span className="flex items-center gap-2 text-sm">
                    {theme.colors && (
                      <span className="flex -space-x-1">
                        {theme.colors.map(c => <ThemePreviewDot key={c} color={c} />)}
                      </span>
                    )}
                    <span className={selected ? 'font-medium' : ''}>{theme.label}</span>
                    {theme.subtitle
                      ? <span className="text-[11px] text-muted-foreground">{theme.subtitle}</span>
                      : null}
                  </span>
                  <RadioIndicator selected={selected} />
                </button>
              )
            })}
          </div>
        </section>
      </div>
    </SettingsPageLayout>
  )
}
