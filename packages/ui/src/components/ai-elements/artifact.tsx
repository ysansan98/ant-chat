'use client'

import type { LucideIcon } from 'lucide-react'
import type { ComponentProps, HTMLAttributes } from 'react'
import { Button } from '@workspace/ui/components/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@workspace/ui/components/tooltip'
import { cn } from '@workspace/ui/lib/utils'
import { XIcon } from 'lucide-react'

export type ArtifactProps = HTMLAttributes<HTMLDivElement>

export function Artifact({ className, ...props }: ArtifactProps) {
  return (
    <div
      className={cn(
        'flex flex-col overflow-hidden rounded-lg border bg-background shadow-sm',
        className,
      )}
      {...props}
    />
  )
}

export type ArtifactHeaderProps = HTMLAttributes<HTMLDivElement>

export function ArtifactHeader({
  className,
  ...props
}: ArtifactHeaderProps) {
  return (
    <div
      className={cn(
        'flex items-center justify-between border-b bg-muted/50 px-4 py-3',
        className,
      )}
      {...props}
    />
  )
}

export type ArtifactCloseProps = ComponentProps<typeof Button>

export function ArtifactClose({
  className,
  children,
  size = 'sm',
  variant = 'ghost',
  ...props
}: ArtifactCloseProps) {
  return (
    <Button
      className={cn(
        'size-8 p-0 text-muted-foreground hover:text-foreground',
        className,
      )}
      size={size}
      type="button"
      variant={variant}
      {...props}
    >
      {children ?? <XIcon className="size-4" />}
      <span className="sr-only">Close</span>
    </Button>
  )
}

export type ArtifactTitleProps = HTMLAttributes<HTMLParagraphElement>

export function ArtifactTitle({ className, ...props }: ArtifactTitleProps) {
  return (
    <p
      className={cn('font-medium text-foreground text-sm', className)}
      {...props}
    />
  )
}

export type ArtifactDescriptionProps = HTMLAttributes<HTMLParagraphElement>

export function ArtifactDescription({
  className,
  ...props
}: ArtifactDescriptionProps) {
  return <p className={cn('text-muted-foreground text-sm', className)} {...props} />
}

export type ArtifactActionsProps = HTMLAttributes<HTMLDivElement>

export function ArtifactActions({
  className,
  ...props
}: ArtifactActionsProps) {
  return <div className={cn('flex items-center gap-1', className)} {...props} />
}

export type ArtifactActionProps = ComponentProps<typeof Button> & {
  tooltip?: string
  label?: string
  icon?: LucideIcon
}

export function ArtifactAction({
  tooltip,
  label,
  icon: Icon,
  children,
  className,
  size = 'sm',
  variant = 'ghost',
  ...props
}: ArtifactActionProps) {
  const button = (
    <Button
      className={cn(
        'size-8 p-0 text-muted-foreground hover:text-foreground',
        className,
      )}
      size={size}
      type="button"
      variant={variant}
      {...props}
    >
      {Icon ? <Icon className="size-4" /> : children}
      <span className="sr-only">{label || tooltip}</span>
    </Button>
  )

  if (tooltip) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent>
            <p>{tooltip}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  return button
}

export type ArtifactContentProps = HTMLAttributes<HTMLDivElement>

export function ArtifactContent({
  className,
  ...props
}: ArtifactContentProps) {
  return <div className={cn('flex-1 overflow-auto p-4', className)} {...props} />
}
