'use client'

import type { UIMessage } from 'ai'
import type { ComponentProps, HTMLAttributes, ReactElement } from 'react'
import { cjk } from '@streamdown/cjk'
import { code } from '@streamdown/code'
import { math } from '@streamdown/math'
import { mermaid } from '@streamdown/mermaid'
import { Button } from '@workspace/ui/components/button'
import {
  ButtonGroup,
  ButtonGroupText,
} from '@workspace/ui/components/button-group'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@workspace/ui/components/tooltip'
import { useSmoothContent } from '@workspace/ui/hooks/useSmoothContent'
import { installClipboardTextFallback } from '@workspace/ui/lib/clipboard'
import { cn } from '@workspace/ui/lib/utils'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import {
  createContext,
  memo,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { Streamdown } from 'streamdown'

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: UIMessage['role']
}

export function Message({ className, from, ...props }: MessageProps) {
  return (
    <div
      className={cn(
        'group/message flex w-full max-w-[95%] flex-col gap-2',
        from === 'user' ? 'is-user ml-auto justify-end' : 'is-assistant',
        className,
      )}
      {...props}
    />
  )
}

export type MessageContentProps = HTMLAttributes<HTMLDivElement>

export function MessageContent({
  children,
  className,
  ...props
}: MessageContentProps) {
  return (
    <div
      className={cn(
        'is-user:dark flex w-fit min-w-0 max-w-full flex-col gap-2 overflow-hidden text-sm',
        'group-[.is-user]/message:ml-auto group-[.is-user]/message:rounded-lg group-[.is-user]/message:bg-secondary group-[.is-user]/message:px-4 group-[.is-user]/message:py-3 group-[.is-user]/message:text-foreground',
        'group-[.is-assistant]/message:text-foreground',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export type MessageActionsProps = ComponentProps<'div'>

export function MessageActions({
  className,
  children,
  ...props
}: MessageActionsProps) {
  return (
    <div className={cn('flex items-center gap-1', className)} {...props}>
      {children}
    </div>
  )
}

export type MessageActionProps = ComponentProps<typeof Button> & {
  tooltip?: string
  label?: string
}

export function MessageAction({
  tooltip,
  children,
  label,
  variant = 'ghost',
  size = 'icon-sm',
  ...props
}: MessageActionProps) {
  const button = (
    <Button size={size} type="button" variant={variant} {...props}>
      {children}
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

interface MessageBranchContextType {
  currentBranch: number
  totalBranches: number
  goToPrevious: () => void
  goToNext: () => void
  branches: ReactElement[]
  setBranches: (branches: ReactElement[]) => void
}

const MessageBranchContext = createContext<MessageBranchContextType | null>(
  null,
)

function useMessageBranch() {
  const context = use(MessageBranchContext)

  if (!context) {
    throw new Error(
      'MessageBranch components must be used within MessageBranch',
    )
  }

  return context
}

export type MessageBranchProps = HTMLAttributes<HTMLDivElement> & {
  defaultBranch?: number
  onBranchChange?: (branchIndex: number) => void
}

export function MessageBranch({
  defaultBranch = 0,
  onBranchChange,
  className,
  ...props
}: MessageBranchProps) {
  const [currentBranch, setCurrentBranch] = useState(defaultBranch)
  const [branches, setBranches] = useState<ReactElement[]>([])

  const handleBranchChange = useCallback(
    (newBranch: number) => {
      setCurrentBranch(newBranch)
      onBranchChange?.(newBranch)
    },
    [onBranchChange],
  )

  const goToPrevious = useCallback(() => {
    const newBranch
      = currentBranch > 0 ? currentBranch - 1 : branches.length - 1
    handleBranchChange(newBranch)
  }, [currentBranch, branches.length, handleBranchChange])

  const goToNext = useCallback(() => {
    const newBranch
      = currentBranch < branches.length - 1 ? currentBranch + 1 : 0
    handleBranchChange(newBranch)
  }, [currentBranch, branches.length, handleBranchChange])

  const contextValue = useMemo<MessageBranchContextType>(
    () => ({
      branches,
      currentBranch,
      goToNext,
      goToPrevious,
      setBranches,
      totalBranches: branches.length,
    }),
    [branches, currentBranch, goToNext, goToPrevious],
  )

  return (
    <MessageBranchContext value={contextValue}>
      <div
        className={cn('grid w-full gap-2 [&>div]:pb-0', className)}
        {...props}
      />
    </MessageBranchContext>
  )
}

export type MessageBranchContentProps = HTMLAttributes<HTMLDivElement>

export function MessageBranchContent({
  children,
  ...props
}: MessageBranchContentProps) {
  const { currentBranch, setBranches, branches } = useMessageBranch()
  const childrenArray = useMemo(
    () => (Array.isArray(children) ? children : [children]),
    [children],
  )

  // Use useEffect to update branches when they change
  useEffect(() => {
    if (branches.length !== childrenArray.length) {
      setBranches(childrenArray)
    }
  }, [childrenArray, branches, setBranches])

  return childrenArray.map((branch, index) => (
    <div
      className={cn(
        'grid gap-2 overflow-hidden [&>div]:pb-0',
        index === currentBranch ? 'block' : 'hidden',
      )}
      key={branch.key}
      {...props}
    >
      {branch}
    </div>
  ))
}

export type MessageBranchSelectorProps = ComponentProps<typeof ButtonGroup>

export function MessageBranchSelector({
  className,
  ...props
}: MessageBranchSelectorProps) {
  const { totalBranches } = useMessageBranch()

  // Don't render if there's only one branch
  if (totalBranches <= 1) {
    return null
  }

  return (
    <ButtonGroup
      className={cn(
        '[&>*:not(:first-child)]:rounded-l-md [&>*:not(:last-child)]:rounded-r-md',
        className,
      )}
      orientation="horizontal"
      {...props}
    />
  )
}

export type MessageBranchPreviousProps = ComponentProps<typeof Button>

export function MessageBranchPrevious({
  children,
  ...props
}: MessageBranchPreviousProps) {
  const { goToPrevious, totalBranches } = useMessageBranch()

  return (
    <Button
      aria-label="Previous branch"
      disabled={totalBranches <= 1}
      onClick={goToPrevious}
      size="icon-sm"
      type="button"
      variant="ghost"
      {...props}
    >
      {children ?? <ChevronLeftIcon size={14} />}
    </Button>
  )
}

export type MessageBranchNextProps = ComponentProps<typeof Button>

export function MessageBranchNext({
  children,
  ...props
}: MessageBranchNextProps) {
  const { goToNext, totalBranches } = useMessageBranch()

  return (
    <Button
      aria-label="Next branch"
      disabled={totalBranches <= 1}
      onClick={goToNext}
      size="icon-sm"
      type="button"
      variant="ghost"
      {...props}
    >
      {children ?? <ChevronRightIcon size={14} />}
    </Button>
  )
}

export type MessageBranchPageProps = HTMLAttributes<HTMLSpanElement>

export function MessageBranchPage({
  className,
  ...props
}: MessageBranchPageProps) {
  const { currentBranch, totalBranches } = useMessageBranch()

  return (
    <ButtonGroupText
      className={cn(
        'border-none bg-transparent text-muted-foreground shadow-none',
        className,
      )}
      {...props}
    >
      {currentBranch + 1}
      {' '}
      of
      {totalBranches}
    </ButtonGroupText>
  )
}

export type MessageResponseProps = ComponentProps<typeof Streamdown>

const streamdownPlugins = { cjk, code, math, mermaid }

const streamAnimated = {
  animation: 'fadeIn' as const,
  duration: 280,
  easing: 'cubic-bezier(0.33, 0, 0.67, 1)',
  sep: 'char' as const,
  stagger: 0,
}

export const MessageResponse = memo(
  ({ className, children, isAnimating, ...props }: MessageResponseProps) => {
    const smoothed = useSmoothContent(
      typeof children === 'string' ? children : '',
      isAnimating ?? false,
    )

    useEffect(() => installClipboardTextFallback(), [])

    return (
      <Streamdown
        className={cn(
          'size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
          className,
        )}
        plugins={streamdownPlugins}
        animated={streamAnimated}
        isAnimating={isAnimating}
        {...props}
      >
        {smoothed}
      </Streamdown>
    )
  },
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children
    && nextProps.isAnimating === prevProps.isAnimating,
)

MessageResponse.displayName = 'MessageResponse'

export type MessageToolbarProps = ComponentProps<'div'>

export function MessageToolbar({
  className,
  children,
  ...props
}: MessageToolbarProps) {
  return (
    <div
      className={cn(
        'mt-4 flex w-full items-center justify-between gap-4',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}
