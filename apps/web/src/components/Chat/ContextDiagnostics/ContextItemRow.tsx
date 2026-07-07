import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { useRef } from 'react'

// ================================================================
// ContextItemRow — 单个 Context Item 行
// ================================================================

export interface ContextItemRowProps {
  requestId: string
  summary: string
  kind: string
  status: 'full' | 'added' | 'updated' | 'removed'
  size?: string
  isExpanded: boolean
  onToggle: () => void
  children?: ReactNode
}

const statusColorMap: Record<string, string> = {
  full: 'text-muted-foreground border-muted-foreground/40',
  added: 'text-emerald-500 border-emerald-500/50',
  updated: 'text-amber-500 border-amber-500/50',
  removed: 'text-red-500 border-red-500/50',
}

const statusLabelMap: Record<string, string> = {
  full: 'Full',
  added: 'Added',
  updated: 'Updated',
  removed: 'Removed',
}

export function ContextItemRow({
  summary,
  kind,
  status,
  size,
  isExpanded,
  onToggle,
  children,
}: ContextItemRowProps) {
  const contentRef = useRef<HTMLDivElement>(null)

  return (
    <div className={`border-b border-border/40 last:border-b-0 ${isExpanded ? 'bg-accent/5' : ''}`}>
      <button
        type="button"
        onClick={onToggle}
        className="grid w-full cursor-pointer grid-cols-[18px_auto_auto_1fr_auto] items-center gap-2 px-2 py-1.5 text-left hover:bg-accent/5"
      >
        <ChevronRight
          className={`size-3 text-muted-foreground/60 transition-transform duration-150 ${
            isExpanded ? 'rotate-90' : ''
          }`}
        />
        <span
          className={`inline-flex items-center rounded-[3px] border px-1 py-[1px] text-[8px] font-bold uppercase leading-none tracking-wide ${
            statusColorMap[status]
          }`}
        >
          {statusLabelMap[status]}
        </span>
        <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground/80">
          {kind}
        </span>
        <span className="truncate text-[12px] text-foreground/85">{summary}</span>
        {size && (
          <span className="text-[10px] text-muted-foreground/60">{size}</span>
        )}
      </button>

      {isExpanded && (
        <div
          ref={contentRef}
          className="mx-4 mb-2 max-h-[320px] overflow-auto rounded-lg border border-border/50 bg-code p-2.5 text-[11px] leading-relaxed text-code-foreground"
        >
          {children}
        </div>
      )}
    </div>
  )
}
