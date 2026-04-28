'use client'

import type { LucideProps } from 'lucide-react'
import type { ComponentProps, HTMLAttributes } from 'react'
import { Button } from '@workspace/ui/components/button'
import { Separator } from '@workspace/ui/components/separator'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@workspace/ui/components/tooltip'
import { cn } from '@workspace/ui/lib/utils'
import { BookmarkIcon } from 'lucide-react'

export type CheckpointProps = HTMLAttributes<HTMLDivElement>

export function Checkpoint({
  className,
  children,
  ...props
}: CheckpointProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-0.5 overflow-hidden text-muted-foreground',
        className,
      )}
      {...props}
    >
      {children}
      <Separator />
    </div>
  )
}

export type CheckpointIconProps = LucideProps

export function CheckpointIcon({
  className,
  children,
  ...props
}: CheckpointIconProps) {
  return children ?? (
    <BookmarkIcon className={cn('size-4 shrink-0', className)} {...props} />
  )
}

export type CheckpointTriggerProps = ComponentProps<typeof Button> & {
  tooltip?: string
}

export function CheckpointTrigger({
  children,
  variant = 'ghost',
  size = 'sm',
  tooltip,
  ...props
}: CheckpointTriggerProps) {
  return tooltip
    ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size={size} type="button" variant={variant} {...props}>
              {children}
            </Button>
          </TooltipTrigger>
          <TooltipContent align="start" side="bottom">
            {tooltip}
          </TooltipContent>
        </Tooltip>
      )
    : (
        <Button size={size} type="button" variant={variant} {...props}>
          {children}
        </Button>
      )
}
