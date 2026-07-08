// ================================================================
// Dividers — Turn、Model Request 和 Compaction 分割线
// ================================================================

import { ArrowDownToDot } from 'lucide-react'

export interface TurnDividerProps {
  turn: number
  time?: string
}

export function TurnDivider({ turn, time }: TurnDividerProps) {
  return (
    <div className="flex items-center gap-3 py-1">
      <span className="text-[10px] font-bold tracking-wider text-muted-foreground/60 uppercase">
        Turn
        {' '}
        {turn}
      </span>
      {time && (
        <span className="text-[9px] text-muted-foreground/40">{time}</span>
      )}
      <div className="h-px flex-1 bg-border/40" />
    </div>
  )
}

// ================================================================

export interface ModelRequestDividerProps {
  step: number
  kind: string
  time?: string
}

export function ModelRequestDivider({ step, kind, time }: ModelRequestDividerProps) {
  return (
    <div className="flex items-center gap-2 py-0.5 pl-4">
      <span className="text-[10px] text-muted-foreground/70">
        Model Request
        {' '}
        {step}
      </span>
      <span className="text-[9px] font-bold text-muted-foreground/50">
        {kind}
      </span>
      {time && (
        <span className="text-[9px] text-muted-foreground/40">{time}</span>
      )}
      <div className="h-px flex-1 bg-border/20" />
    </div>
  )
}

// ================================================================

export interface CompactionBoundaryProps {
  trigger: 'automatic' | 'manual'
  time?: string
}

export function CompactionBoundary({ trigger, time }: CompactionBoundaryProps) {
  return (
    <div className="flex items-center gap-2 py-2">
      <ArrowDownToDot className="size-3 text-amber-500/70" />
      <span className="text-[10px] font-bold tracking-wider text-amber-500/70 uppercase">
        Compaction
      </span>
      <span className="text-[9px] text-amber-500/50">
        ·
        {' '}
        {trigger === 'automatic' ? '自动' : '手动'}
      </span>
      {time && (
        <span className="text-[9px] text-amber-500/40">{time}</span>
      )}
      <div className="h-px flex-1 bg-amber-500/15" />
    </div>
  )
}
