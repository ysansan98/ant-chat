'use client'

import type { ComponentProps } from 'react'
import { Button } from '@workspace/ui/components/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@workspace/ui/components/collapsible'
import { ScrollArea } from '@workspace/ui/components/scroll-area'
import { cn } from '@workspace/ui/lib/utils'
import { ChevronDownIcon, PaperclipIcon } from 'lucide-react'

export interface QueueMessagePart {
  type: string
  text?: string
  url?: string
  filename?: string
  mediaType?: string
}

export interface QueueMessage {
  id: string
  parts: QueueMessagePart[]
}

export interface QueueTodo {
  id: string
  title: string
  description?: string
  status?: 'pending' | 'completed'
}

export type QueueItemProps = ComponentProps<'li'>

export function QueueItem({ className, ...props }: QueueItemProps) {
  return (
    <li
      className={cn(
        'group flex flex-col gap-1 rounded-md px-3 py-1 text-sm transition-colors hover:bg-muted',
        className,
      )}
      {...props}
    />
  )
}

export type QueueItemIndicatorProps = ComponentProps<'span'> & {
  completed?: boolean
}

export function QueueItemIndicator({
  completed = false,
  className,
  ...props
}: QueueItemIndicatorProps) {
  return (
    <span
      className={cn(
        'mt-0.5 inline-block size-2.5 rounded-full border',
        completed
          ? 'border-muted-foreground/20 bg-muted-foreground/10'
          : 'border-muted-foreground/50',
        className,
      )}
      {...props}
    />
  )
}

export type QueueItemContentProps = ComponentProps<'span'> & {
  completed?: boolean
}

export function QueueItemContent({
  completed = false,
  className,
  ...props
}: QueueItemContentProps) {
  return (
    <span
      className={cn(
        'line-clamp-1 grow break-words',
        completed
          ? 'text-muted-foreground/50 line-through'
          : 'text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}

export type QueueItemDescriptionProps = ComponentProps<'div'> & {
  completed?: boolean
}

export function QueueItemDescription({
  completed = false,
  className,
  ...props
}: QueueItemDescriptionProps) {
  return (
    <div
      className={cn(
        'ml-6 text-xs',
        completed
          ? 'text-muted-foreground/40 line-through'
          : 'text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}

export type QueueItemActionsProps = ComponentProps<'div'>

export function QueueItemActions({
  className,
  ...props
}: QueueItemActionsProps) {
  return <div className={cn('flex gap-1', className)} {...props} />
}

export type QueueItemActionProps = Omit<
  ComponentProps<typeof Button>,
  'variant' | 'size'
>

export function QueueItemAction({
  className,
  ...props
}: QueueItemActionProps) {
  return (
    <Button
      className={cn(
        'size-auto rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted-foreground/10 hover:text-foreground group-hover:opacity-100',
        className,
      )}
      size="icon"
      type="button"
      variant="ghost"
      {...props}
    />
  )
}

export type QueueItemAttachmentProps = ComponentProps<'div'>

export function QueueItemAttachment({
  className,
  ...props
}: QueueItemAttachmentProps) {
  return <div className={cn('mt-1 flex flex-wrap gap-2', className)} {...props} />
}

export type QueueItemImageProps = ComponentProps<'img'>

export function QueueItemImage({
  className,
  ...props
}: QueueItemImageProps) {
  return (
    <img
      alt=""
      className={cn('h-8 w-8 rounded border object-cover', className)}
      height={32}
      width={32}
      {...props}
    />
  )
}

export type QueueItemFileProps = ComponentProps<'span'>

export function QueueItemFile({
  children,
  className,
  ...props
}: QueueItemFileProps) {
  return (
    <span
      className={cn(
        'flex items-center gap-1 rounded border bg-muted px-2 py-1 text-xs',
        className,
      )}
      {...props}
    >
      <PaperclipIcon size={12} />
      <span className="max-w-[100px] truncate">{children}</span>
    </span>
  )
}

export type QueueListProps = ComponentProps<typeof ScrollArea>

export function QueueList({
  children,
  className,
  ...props
}: QueueListProps) {
  return (
    <ScrollArea className={cn('mt-2 -mb-1', className)} {...props}>
      <div className="max-h-40 pr-4">
        <ul>{children}</ul>
      </div>
    </ScrollArea>
  )
}

// QueueSection - collapsible section container
export type QueueSectionProps = ComponentProps<typeof Collapsible>

export function QueueSection({
  className,
  defaultOpen = true,
  ...props
}: QueueSectionProps) {
  return <Collapsible className={cn(className)} defaultOpen={defaultOpen} {...props} />
}

// QueueSectionTrigger - section header/trigger
export type QueueSectionTriggerProps = ComponentProps<'button'>

export function QueueSectionTrigger({
  children,
  className,
  ...props
}: QueueSectionTriggerProps) {
  return (
    <CollapsibleTrigger asChild>
      <button
        className={cn(
          'group flex w-full items-center justify-between rounded-md bg-muted/40 px-3 py-2 text-left font-medium text-muted-foreground text-sm transition-colors hover:bg-muted',
          className,
        )}
        type="button"
        {...props}
      >
        {children}
      </button>
    </CollapsibleTrigger>
  )
}

// QueueSectionLabel - label content with icon and count
export type QueueSectionLabelProps = ComponentProps<'span'> & {
  count?: number
  label: string
  icon?: React.ReactNode
}

export function QueueSectionLabel({
  count,
  label,
  icon,
  className,
  ...props
}: QueueSectionLabelProps) {
  return (
    <span className={cn('flex items-center gap-2', className)} {...props}>
      <ChevronDownIcon className="size-4 transition-transform group-data-[state=closed]:-rotate-90" />
      {icon}
      <span>
        {count}
        {' '}
        {label}
      </span>
    </span>
  )
}

// QueueSectionContent - collapsible content area
export type QueueSectionContentProps = ComponentProps<
  typeof CollapsibleContent
>

export function QueueSectionContent({
  className,
  ...props
}: QueueSectionContentProps) {
  return <CollapsibleContent className={cn(className)} {...props} />
}

export type QueueProps = ComponentProps<'div'>

export function Queue({ className, ...props }: QueueProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-xl border border-border bg-background px-3 pt-2 pb-2 shadow-xs',
        className,
      )}
      {...props}
    />
  )
}
