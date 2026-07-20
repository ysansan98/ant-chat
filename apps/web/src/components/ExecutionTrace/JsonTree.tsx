import { cn } from '@workspace/ui/lib/utils'
import { ChevronRightIcon } from 'lucide-react'
import { useState } from 'react'

/**
 * 轻量 JSON 树：可折叠、语法着色、惰性渲染子节点。
 * 原始证据可能包含数千条流式 chunk，折叠节点不渲染子树，避免 DOM 爆炸。
 * 不引入第三方 JSON viewer 依赖。
 */

interface JsonTreeProps {
  value: unknown
  /** 根节点标签；不传则不显示 key */
  label?: string
  /** 小于该深度的节点默认展开；超长数组始终默认折叠 */
  expandDepth?: number
  className?: string
}

const COLLAPSE_ARRAY_LENGTH = 50
const LONG_STRING_LIMIT = 300

export function JsonTree({ value, label, expandDepth = 1, className }: JsonTreeProps) {
  return (
    <div className={cn('rounded-lg bg-code p-3 text-xs/relaxed text-code-foreground', className)}>
      <JsonNode label={label} value={value} depth={0} expandDepth={expandDepth} />
    </div>
  )
}

function JsonNode({ label, value, depth, expandDepth }: { label?: string, value: unknown, depth: number, expandDepth: number }) {
  if (value !== null && typeof value === 'object') {
    return <JsonContainer label={label} value={value as Record<string, unknown> | unknown[]} depth={depth} expandDepth={expandDepth} />
  }
  return (
    <div className="flex min-w-0 items-baseline gap-1.5">
      {label !== undefined && <JsonKey label={label} />}
      <JsonPrimitive value={value} />
    </div>
  )
}

function JsonContainer({ label, value, depth, expandDepth }: { label?: string, value: Record<string, unknown> | unknown[], depth: number, expandDepth: number }) {
  const isArray = Array.isArray(value)
  const entries = isArray ? value.map((item, index) => [String(index), item] as const) : Object.entries(value)
  const alwaysCollapse = isArray && value.length > COLLAPSE_ARRAY_LENGTH
  const [open, setOpen] = useState(!alwaysCollapse && depth < expandDepth)
  const preview = isArray ? `[${value.length} 项]` : `{${entries.length} 键}`
  return (
    <div className="min-w-0">
      <button
        type="button"
        className="flex w-full min-w-0 items-baseline gap-1.5 rounded-sm text-left hover:bg-white/5"
        onClick={() => setOpen(current => !current)}
        aria-expanded={open}
      >
        <ChevronRightIcon className={cn('size-3 shrink-0 self-center text-muted-foreground transition-transform', open && 'rotate-90')} />
        {label !== undefined && <JsonKey label={label} />}
        <span className="text-muted-foreground">{isArray ? '[' : '{'}</span>
        {!open && <span className="truncate text-muted-foreground">{preview}</span>}
        {!open && <span className="text-muted-foreground">{isArray ? ']' : '}'}</span>}
      </button>
      {open && (
        <div className="ml-2 border-l border-white/10 pl-3">
          {entries.length === 0 && <div className="text-muted-foreground">（空）</div>}
          {entries.map(([key, child]) => (
            <JsonNode key={key} label={isArray ? undefined : key} value={child} depth={depth + 1} expandDepth={expandDepth} />
          ))}
          <div className="text-muted-foreground">{isArray ? ']' : '}'}</div>
        </div>
      )}
    </div>
  )
}

function JsonKey({ label }: { label: string }) {
  return (
    <span className="shrink-0 text-sky-700 dark:text-sky-300">
      {label}
      :
    </span>
  )
}

function JsonPrimitive({ value }: { value: unknown }) {
  if (typeof value === 'string')
    return <JsonString value={value} />
  if (typeof value === 'number')
    return <span className="break-all text-violet-700 dark:text-violet-300">{String(value)}</span>
  if (typeof value === 'boolean')
    return <span className="text-amber-700 dark:text-amber-300">{String(value)}</span>
  if (value === null)
    return <span className="text-muted-foreground">null</span>
  if (value === undefined)
    return <span className="text-muted-foreground">undefined</span>
  return <span className="break-all">{String(value)}</span>
}

function JsonString({ value }: { value: string }) {
  const [open, setOpen] = useState(false)
  const long = value.length > LONG_STRING_LIMIT
  const shown = long && !open ? `${value.slice(0, LONG_STRING_LIMIT)}…` : value
  return (
    <span className="min-w-0 break-all whitespace-pre-wrap text-emerald-700 dark:text-emerald-300">
      "
      {shown}
      "
      {long && (
        <button type="button" className="ml-1 text-primary hover:underline" onClick={() => setOpen(current => !current)}>
          {open ? '收起' : `展开（${value.length} 字符）`}
        </button>
      )}
    </span>
  )
}
