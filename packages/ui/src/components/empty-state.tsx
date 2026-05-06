import { cn } from '@workspace/ui/lib/utils'
import * as React from 'react'

function EmptyState({
  className,
  icon,
  title,
  description,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  icon?: React.ReactNode
  title?: string
  description?: string
}) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        'flex flex-col items-center justify-center gap-3 py-8 text-center',
        className,
      )}
      {...props}
    >
      {icon && (
        <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground [&_svg]:size-6">
          {icon}
        </div>
      )}
      {title && <p className="text-sm font-medium text-foreground">{title}</p>}
      {description && (
        <p className="max-w-xs text-sm text-muted-foreground">{description}</p>
      )}
      {children}
    </div>
  )
}

export { EmptyState }
