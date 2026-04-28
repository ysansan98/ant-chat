import type { ComponentProps } from 'react'
import { cn } from '@workspace/ui/lib/utils'
import { NodeToolbar, Position } from '@xyflow/react'

type ToolbarProps = ComponentProps<typeof NodeToolbar>

export function Toolbar({ className, ...props }: ToolbarProps) {
  return (
    <NodeToolbar
      className={cn(
        'flex items-center gap-1 rounded-sm border bg-background p-1.5',
        className,
      )}
      position={Position.Bottom}
      {...props}
    />
  )
}
