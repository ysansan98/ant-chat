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
      bg-sidebar-accent text-sidebar-accent-foreground
    `
    : ''

  return (
    <button
      data-testid={dataTestId}
      disabled={disabled}
      className={`
        flex h-9 items-center justify-start gap-1 rounded-md px-3 text-sm font-medium
        text-sidebar-foreground/70
        hover:bg-sidebar-accent hover:text-sidebar-accent-foreground
        ${activeClass}
      `}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  )
}
