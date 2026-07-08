import type { ReactNode } from 'react'

interface SettingsPageHeaderProps {
  title: string
  description?: ReactNode
  actions?: ReactNode
}

/**
 * 统一设置页的信息起点，避免各页面依赖 Card 默认字号形成不一致的标题层级。
 */
export function SettingsPageHeader({ title, description, actions }: SettingsPageHeaderProps) {
  return (
    <header className="flex min-h-14 shrink-0 flex-col items-start justify-between gap-3 lg:flex-row">
      <div className="min-w-0">
        <h1 className="text-xl/7 font-semibold tracking-tight text-balance">
          {title}
        </h1>
        {description && (
          <div className="mt-1 truncate text-xs/4 text-muted-foreground">
            {description}
          </div>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 lg:shrink-0">{actions}</div>}
    </header>
  )
}
