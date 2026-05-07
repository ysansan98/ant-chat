import type { ReactNode } from 'react'

interface SidebarNavItemProps {
  icon: ReactNode
  label: string
  active?: boolean
  dataTestId?: string
  disabled?: boolean
  onClick?: () => void
}

export function SidebarNavItem({ icon, label, active, dataTestId, disabled, onClick }: SidebarNavItemProps) {
  const activeClass = active
    ? `
      bg-black/5 text-slate-700
      dark:bg-white/10 dark:text-slate-200
    `
    : ''

  return (
    <button
      data-testid={dataTestId}
      disabled={disabled}
      className={`
        flex h-9 items-center justify-start gap-1 rounded-md px-3 text-[14px] font-medium
        text-slate-500
        hover:bg-black/5
        dark:text-slate-400
        dark:hover:bg-white/10
        ${activeClass}
      `}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  )
}
