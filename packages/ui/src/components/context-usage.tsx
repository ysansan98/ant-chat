'use client'

import type { LanguageModelUsage } from 'ai'
import type { ComponentProps } from 'react'
import { Button } from '@workspace/ui/components/button'
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@workspace/ui/components/hover-card'
import { Progress } from '@workspace/ui/components/progress'
import { cn } from '@workspace/ui/lib/utils'
import { createContext, use, useMemo } from 'react'

const PERCENT_MAX = 100
const ICON_RADIUS = 10
const ICON_VIEWBOX = 24
const ICON_CENTER = 12
const ICON_STROKE_WIDTH = 2

interface ContextUsageState {
  usedTokens: number
  maxTokens: number
  usage?: LanguageModelUsage
}

const ContextUsageCtx = createContext<ContextUsageState | null>(null)

function useCtx() {
  const ctx = use(ContextUsageCtx)
  if (!ctx) {
    throw new Error('ContextUsage components must be used within ContextUsage')
  }
  return ctx
}

export type ContextUsageProps = ComponentProps<typeof HoverCard> & ContextUsageState

export function ContextUsage({
  usedTokens,
  maxTokens,
  usage,
  ...props
}: ContextUsageProps) {
  const value = useMemo(
    () => ({ maxTokens, usage, usedTokens }),
    [maxTokens, usage, usedTokens],
  )

  return (
    <ContextUsageCtx value={value}>
      <HoverCard closeDelay={0} openDelay={0} {...props} />
    </ContextUsageCtx>
  )
}

function CircleIcon() {
  const { usedTokens, maxTokens } = useCtx()
  const circumference = 2 * Math.PI * ICON_RADIUS
  const usedPercent = maxTokens > 0 ? usedTokens / maxTokens : 0
  const dashOffset = circumference * (1 - Math.min(usedPercent, 1))

  return (
    <svg
      aria-label="Model context usage"
      height="20"
      role="img"
      style={{ color: 'currentcolor' }}
      viewBox={`0 0 ${ICON_VIEWBOX} ${ICON_VIEWBOX}`}
      width="20"
    >
      <circle
        cx={ICON_CENTER}
        cy={ICON_CENTER}
        fill="none"
        opacity="0.25"
        r={ICON_RADIUS}
        stroke="currentColor"
        strokeWidth={ICON_STROKE_WIDTH}
      />
      <circle
        cx={ICON_CENTER}
        cy={ICON_CENTER}
        fill="none"
        opacity="0.7"
        r={ICON_RADIUS}
        stroke="currentColor"
        strokeDasharray={`${circumference} ${circumference}`}
        strokeDashoffset={dashOffset}
        strokeLinecap="round"
        strokeWidth={ICON_STROKE_WIDTH}
        style={{ transform: 'rotate(-90deg)', transformOrigin: 'center' }}
      />
    </svg>
  )
}

export type ContextUsageTriggerProps = ComponentProps<typeof Button>

export function ContextUsageTrigger({ children, ...props }: ContextUsageTriggerProps) {
  const { usedTokens, maxTokens } = useCtx()
  const usedPercent = maxTokens > 0 ? usedTokens / maxTokens : 0
  const renderedPercent = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 1,
    style: 'percent',
  }).format(Math.min(usedPercent, 1))

  return (
    <HoverCardTrigger asChild>
      {children ?? (
        <Button type="button" variant="ghost" {...props}>
          <span className="font-medium text-muted-foreground">
            {renderedPercent}
          </span>
          <CircleIcon />
        </Button>
      )}
    </HoverCardTrigger>
  )
}

export type ContextUsageContentProps = ComponentProps<typeof HoverCardContent>

export function ContextUsageContent({ className, ...props }: ContextUsageContentProps) {
  return (
    <HoverCardContent
      className={cn('min-w-60 divide-y overflow-hidden p-0', className)}
      {...props}
    />
  )
}

function fmtCompact(n: number) {
  return new Intl.NumberFormat('en-US', { notation: 'compact' }).format(n)
}

export type ContextUsageHeaderProps = ComponentProps<'div'>

export function ContextUsageHeader({
  children,
  className,
  ...props
}: ContextUsageHeaderProps) {
  const { usedTokens, maxTokens } = useCtx()
  const usedPercent = maxTokens > 0 ? usedTokens / maxTokens : 0
  const displayPct = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 1,
    style: 'percent',
  }).format(Math.min(usedPercent, 1))

  return (
    <div className={cn('w-full space-y-2 p-3', className)} {...props}>
      {children ?? (
        <>
          <div className="flex items-center justify-between gap-3 text-xs">
            <p>{displayPct}</p>
            <p className="font-mono text-muted-foreground">
              {fmtCompact(usedTokens)}
              {' / '}
              {fmtCompact(maxTokens)}
            </p>
          </div>
          <div className="space-y-2">
            <Progress className="bg-muted" value={Math.min(usedPercent, 1) * PERCENT_MAX} />
          </div>
        </>
      )}
    </div>
  )
}

export type ContextUsageBodyProps = ComponentProps<'div'>

export function ContextUsageBody({ children, className, ...props }: ContextUsageBodyProps) {
  return (
    <div className={cn('w-full p-3', className)} {...props}>
      {children}
    </div>
  )
}

// ---- Token breakdown rows (no cost) ----

function TokenRow({ label, tokens }: { label: string, tokens?: number }) {
  return (
    <>
      <span className="text-muted-foreground">{label}</span>
      <span>
        {tokens === undefined
          ? '—'
          : fmtCompact(tokens)}
      </span>
    </>
  )
}

export type ContextUsageInputProps = ComponentProps<'div'>

export function ContextUsageInput({ className, children, ...props }: ContextUsageInputProps) {
  const { usage } = useCtx()
  const tokens = usage?.inputTokens ?? 0

  if (children)
    return children
  if (!tokens)
    return null

  return (
    <div className={cn('flex items-center justify-between text-xs', className)} {...props}>
      <TokenRow label="Input" tokens={tokens} />
    </div>
  )
}

export type ContextUsageOutputProps = ComponentProps<'div'>

export function ContextUsageOutput({ className, children, ...props }: ContextUsageOutputProps) {
  const { usage } = useCtx()
  const tokens = usage?.outputTokens ?? 0

  if (children)
    return children
  if (!tokens)
    return null

  return (
    <div className={cn('flex items-center justify-between text-xs', className)} {...props}>
      <TokenRow label="Output" tokens={tokens} />
    </div>
  )
}

export type ContextUsageReasoningProps = ComponentProps<'div'>

export function ContextUsageReasoning({ className, children, ...props }: ContextUsageReasoningProps) {
  const { usage } = useCtx()
  const tokens = usage?.reasoningTokens ?? 0

  if (children)
    return children
  if (!tokens)
    return null

  return (
    <div className={cn('flex items-center justify-between text-xs', className)} {...props}>
      <TokenRow label="Reasoning" tokens={tokens} />
    </div>
  )
}

export type ContextUsageCacheProps = ComponentProps<'div'>

export function ContextUsageCache({ className, children, ...props }: ContextUsageCacheProps) {
  const { usage } = useCtx()
  const tokens = usage?.cachedInputTokens ?? 0

  if (children)
    return children
  if (!tokens)
    return null

  return (
    <div className={cn('flex items-center justify-between text-xs', className)} {...props}>
      <TokenRow label="Cache" tokens={tokens} />
    </div>
  )
}
