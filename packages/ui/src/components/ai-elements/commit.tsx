'use client'

import type { ComponentProps, HTMLAttributes } from 'react'
import { Avatar, AvatarFallback } from '@workspace/ui/components/avatar'
import { Button } from '@workspace/ui/components/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@workspace/ui/components/collapsible'
import { writeClipboardText } from '@workspace/ui/lib/clipboard'
import { cn } from '@workspace/ui/lib/utils'
import {
  CheckIcon,
  CopyIcon,
  FileIcon,
  GitCommitIcon,
  MinusIcon,
  PlusIcon,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

export type CommitProps = ComponentProps<typeof Collapsible>

export function Commit({ className, children, ...props }: CommitProps) {
  return (
    <Collapsible
      className={cn('rounded-lg border bg-background', className)}
      {...props}
    >
      {children}
    </Collapsible>
  )
}

export type CommitHeaderProps = ComponentProps<typeof CollapsibleTrigger>

export function CommitHeader({
  className,
  children,
  ...props
}: CommitHeaderProps) {
  return (
    <CollapsibleTrigger asChild {...props}>
      <div
        className={cn(
          'group flex cursor-pointer items-center justify-between gap-4 p-3 text-left transition-colors hover:opacity-80',
          className,
        )}
      >
        {children}
      </div>
    </CollapsibleTrigger>
  )
}

export type CommitHashProps = HTMLAttributes<HTMLSpanElement>

export function CommitHash({
  className,
  children,
  ...props
}: CommitHashProps) {
  return (
    <span className={cn('font-mono text-xs', className)} {...props}>
      <GitCommitIcon className="mr-1 inline-block size-3" />
      {children}
    </span>
  )
}

export type CommitMessageProps = HTMLAttributes<HTMLSpanElement>

export function CommitMessage({
  className,
  children,
  ...props
}: CommitMessageProps) {
  return (
    <span className={cn('font-medium text-sm', className)} {...props}>
      {children}
    </span>
  )
}

export type CommitMetadataProps = HTMLAttributes<HTMLDivElement>

export function CommitMetadata({
  className,
  children,
  ...props
}: CommitMetadataProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 text-muted-foreground text-xs',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export type CommitSeparatorProps = HTMLAttributes<HTMLSpanElement>

export function CommitSeparator({
  className,
  children,
  ...props
}: CommitSeparatorProps) {
  return (
    <span className={className} {...props}>
      {children ?? '•'}
    </span>
  )
}

export type CommitInfoProps = HTMLAttributes<HTMLDivElement>

export function CommitInfo({
  className,
  children,
  ...props
}: CommitInfoProps) {
  return (
    <div className={cn('flex flex-1 flex-col', className)} {...props}>
      {children}
    </div>
  )
}

export type CommitAuthorProps = HTMLAttributes<HTMLDivElement>

export function CommitAuthor({
  className,
  children,
  ...props
}: CommitAuthorProps) {
  return (
    <div className={cn('flex items-center', className)} {...props}>
      {children}
    </div>
  )
}

export type CommitAuthorAvatarProps = ComponentProps<typeof Avatar> & {
  initials: string
}

export function CommitAuthorAvatar({
  initials,
  className,
  ...props
}: CommitAuthorAvatarProps) {
  return (
    <Avatar className={cn('size-8', className)} {...props}>
      <AvatarFallback className="text-xs">{initials}</AvatarFallback>
    </Avatar>
  )
}

export type CommitTimestampProps = HTMLAttributes<HTMLTimeElement> & {
  date: Date
}

const relativeTimeFormat = new Intl.RelativeTimeFormat('en', {
  numeric: 'auto',
})

function formatRelativeDate(date: Date) {
  const days = Math.round(
    (date.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
  )
  return relativeTimeFormat.format(days, 'day')
}

export function CommitTimestamp({
  date,
  className,
  children,
  ...props
}: CommitTimestampProps) {
  const [formatted, setFormatted] = useState('')

  const updateFormatted = useCallback(() => {
    setFormatted(formatRelativeDate(date))
  }, [date])

  useEffect(() => {
    updateFormatted()
  }, [updateFormatted])

  return (
    <time
      className={cn('text-xs', className)}
      dateTime={date.toISOString()}
      {...props}
    >
      {children ?? formatted}
    </time>
  )
}

export type CommitActionsProps = HTMLAttributes<HTMLDivElement>

const handleActionsClick = (e: React.MouseEvent) => e.stopPropagation()
const handleActionsKeyDown = (e: React.KeyboardEvent) => e.stopPropagation()

export function CommitActions({
  className,
  children,
  ...props
}: CommitActionsProps) {
  return (
    <div
      className={cn('flex items-center gap-1', className)}
      onClick={handleActionsClick}
      onKeyDown={handleActionsKeyDown}
      role="group"
      {...props}
    >
      {children}
    </div>
  )
}

export type CommitCopyButtonProps = ComponentProps<typeof Button> & {
  hash: string
  onCopy?: () => void
  onError?: (error: Error) => void
  timeout?: number
}

export function CommitCopyButton({
  hash,
  onCopy,
  onError,
  timeout = 2000,
  children,
  className,
  ...props
}: CommitCopyButtonProps) {
  const [isCopied, setIsCopied] = useState(false)
  const timeoutRef = useRef<number>(0)

  const copyToClipboard = useCallback(async () => {
    try {
      if (!isCopied) {
        await writeClipboardText(hash)
        setIsCopied(true)
        onCopy?.()
        timeoutRef.current = window.setTimeout(
          () => setIsCopied(false),
          timeout,
        )
      }
    }
    catch (error) {
      onError?.(error as Error)
    }
  }, [hash, onCopy, onError, timeout, isCopied])

  useEffect(
    () => () => {
      window.clearTimeout(timeoutRef.current)
    },
    [],
  )

  const Icon = isCopied ? CheckIcon : CopyIcon

  return (
    <Button
      className={cn('size-7 shrink-0', className)}
      onClick={copyToClipboard}
      size="icon"
      variant="ghost"
      {...props}
    >
      {children ?? <Icon size={14} />}
    </Button>
  )
}

export type CommitContentProps = ComponentProps<typeof CollapsibleContent>

export function CommitContent({
  className,
  children,
  ...props
}: CommitContentProps) {
  return (
    <CollapsibleContent className={cn('border-t p-3', className)} {...props}>
      {children}
    </CollapsibleContent>
  )
}

export type CommitFilesProps = HTMLAttributes<HTMLDivElement>

export function CommitFiles({
  className,
  children,
  ...props
}: CommitFilesProps) {
  return (
    <div className={cn('space-y-1', className)} {...props}>
      {children}
    </div>
  )
}

export type CommitFileProps = HTMLAttributes<HTMLDivElement>

export function CommitFile({
  className,
  children,
  ...props
}: CommitFileProps) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-2 rounded px-2 py-1 text-sm hover:bg-muted/50',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export type CommitFileInfoProps = HTMLAttributes<HTMLDivElement>

export function CommitFileInfo({
  className,
  children,
  ...props
}: CommitFileInfoProps) {
  return (
    <div className={cn('flex min-w-0 items-center gap-2', className)} {...props}>
      {children}
    </div>
  )
}

const fileStatusStyles = {
  added: 'text-green-600 dark:text-green-400',
  deleted: 'text-red-600 dark:text-red-400',
  modified: 'text-yellow-600 dark:text-yellow-400',
  renamed: 'text-blue-600 dark:text-blue-400',
}

const fileStatusLabels = {
  added: 'A',
  deleted: 'D',
  modified: 'M',
  renamed: 'R',
}

export type CommitFileStatusProps = HTMLAttributes<HTMLSpanElement> & {
  status: 'added' | 'modified' | 'deleted' | 'renamed'
}

export function CommitFileStatus({
  status,
  className,
  children,
  ...props
}: CommitFileStatusProps) {
  return (
    <span
      className={cn(
        'font-medium font-mono text-xs',
        fileStatusStyles[status],
        className,
      )}
      {...props}
    >
      {children ?? fileStatusLabels[status]}
    </span>
  )
}

export type CommitFileIconProps = ComponentProps<typeof FileIcon>

export function CommitFileIcon({
  className,
  ...props
}: CommitFileIconProps) {
  return (
    <FileIcon
      className={cn('size-3.5 shrink-0 text-muted-foreground', className)}
      {...props}
    />
  )
}

export type CommitFilePathProps = HTMLAttributes<HTMLSpanElement>

export function CommitFilePath({
  className,
  children,
  ...props
}: CommitFilePathProps) {
  return (
    <span className={cn('truncate font-mono text-xs', className)} {...props}>
      {children}
    </span>
  )
}

export type CommitFileChangesProps = HTMLAttributes<HTMLDivElement>

export function CommitFileChanges({
  className,
  children,
  ...props
}: CommitFileChangesProps) {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center gap-1 font-mono text-xs',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export type CommitFileAdditionsProps = HTMLAttributes<HTMLSpanElement> & {
  count: number
}

export function CommitFileAdditions({
  count,
  className,
  children,
  ...props
}: CommitFileAdditionsProps) {
  if (count <= 0) {
    return null
  }

  return (
    <span
      className={cn('text-green-600 dark:text-green-400', className)}
      {...props}
    >
      {children ?? (
        <>
          <PlusIcon className="inline-block size-3" />
          {count}
        </>
      )}
    </span>
  )
}

export type CommitFileDeletionsProps = HTMLAttributes<HTMLSpanElement> & {
  count: number
}

export function CommitFileDeletions({
  count,
  className,
  children,
  ...props
}: CommitFileDeletionsProps) {
  if (count <= 0) {
    return null
  }

  return (
    <span
      className={cn('text-red-600 dark:text-red-400', className)}
      {...props}
    >
      {children ?? (
        <>
          <MinusIcon className="inline-block size-3" />
          {count}
        </>
      )}
    </span>
  )
}
