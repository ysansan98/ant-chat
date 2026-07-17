import type { ReactNode } from 'react'
import { SettingsPageHeader } from './SettingsPageHeader'

interface SettingsPageLayoutProps {
  title: string
  description?: ReactNode
  actions?: ReactNode
  /** narrow: max-w-3xl (768px) — 通用/外观/关于；wide: max-w-5xl (1024px) — 服务商/MCP/Skill/记忆/归档 */
  variant: 'narrow' | 'wide'
  children: ReactNode
}

/**
 * 统一的设置页容器，强制所有设置页使用相同的 padding / 限宽 / 居中策略。
 * 组合现有的 SettingsPageHeader，不替换它。
 */
export function SettingsPageLayout({ title, description, actions, variant, children }: SettingsPageLayoutProps) {
  const maxW = variant === 'narrow' ? 'max-w-3xl' : 'max-w-5xl'

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto p-6">
      <div className={`mx-auto flex w-full flex-1 flex-col ${maxW}`}>
        <SettingsPageHeader
          title={title}
          description={description}
          actions={actions}
        />
        <div className="mt-4 flex flex-1 flex-col gap-4">
          {children}
        </div>
      </div>
    </div>
  )
}
