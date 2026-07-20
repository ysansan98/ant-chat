import type { TraceSpanStatus } from '@ant-chat/shared'
import type { MessageBlockView, MessageView } from './evidenceModel'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { writeClipboardText } from '@workspace/ui/lib/clipboard'
import { cn } from '@workspace/ui/lib/utils'
import { CheckIcon, CopyIcon, FileIcon, ImageIcon } from 'lucide-react'
import { useState } from 'react'
import { spanStatusLabel, spanStatusTone } from './evidenceModel'

/** 证据详情共享渲染原语：概览与开发者视图复用，保证两个 Tab 视觉语言一致。 */

const toneClasses = {
  success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  danger: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400',
  warning: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  muted: 'border-border bg-muted text-muted-foreground',
} as const

export function StatusBadge({ status, pending, className }: { status?: TraceSpanStatus, pending: boolean, className?: string }) {
  const tone = spanStatusTone(status, pending)
  return (
    <Badge variant="outline" className={cn(toneClasses[tone], className)}>
      {spanStatusLabel(status, pending)}
    </Badge>
  )
}

export function Section({ title, extra, children }: { title: string, extra?: React.ReactNode, children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold text-muted-foreground">{title}</h4>
        {extra}
      </div>
      {children}
    </section>
  )
}

export function KeyValueList({ items }: { items: Array<{ label: string, value: React.ReactNode }> }) {
  return (
    <dl className="space-y-1 text-xs">
      {items.map(item => (
        <div key={item.label} className="grid grid-cols-[7rem_1fr] items-start gap-2">
          <dt className="text-muted-foreground">{item.label}</dt>
          <dd className="min-w-0 break-all">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function StatGrid({ items }: { items: Array<{ label: string, value: React.ReactNode }> }) {
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {items.map(item => (
        <div key={item.label} className="rounded-lg bg-muted/60 px-2.5 py-2">
          <dt className="text-[11px] text-muted-foreground">{item.label}</dt>
          <dd className="mt-0.5 truncate text-xs font-medium tabular-nums" title={typeof item.value === 'string' ? item.value : undefined}>{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function CopyButton({ text, label, className }: { text: () => string, label?: string, className?: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await writeClipboardText(text())
      setCopied(true)
      setTimeout(setCopied, 1500, false)
    }
    catch {
      setCopied(false)
    }
  }
  return (
    <Button type="button" variant="ghost" size="icon-xs" aria-label={label ?? '复制'} onClick={() => void copy()} className={className}>
      {copied ? <CheckIcon className="size-3.5 text-emerald-600" /> : <CopyIcon className="size-3.5" />}
    </Button>
  )
}

export function CodeBlock({ text, maxHeight = 'max-h-72', className }: { text: string, maxHeight?: string, className?: string }) {
  return (
    <div className={cn('group relative rounded-lg bg-code', className)}>
      <pre className={cn('overflow-auto p-3 pr-9 text-xs/relaxed break-all whitespace-pre-wrap text-code-foreground', maxHeight)}>{text}</pre>
      <CopyButton text={() => text} label="复制内容" className="absolute top-1.5 right-1.5 opacity-60 hover:opacity-100" />
    </div>
  )
}

export function ExpandableText({ text, limit = 280, className }: { text: string, limit?: number, className?: string }) {
  const [open, setOpen] = useState(false)
  if (text.length <= limit)
    return <p className={cn('text-xs/relaxed break-all whitespace-pre-wrap', className)}>{text}</p>
  return (
    <div className={className}>
      <p className="text-xs/relaxed break-all whitespace-pre-wrap">{open ? text : `${text.slice(0, limit)}…`}</p>
      <button type="button" className="mt-1 text-xs text-primary hover:underline" onClick={() => setOpen(current => !current)}>
        {open ? '收起' : `展开全部（${text.length} 字符）`}
      </button>
    </div>
  )
}

export function ErrorBlock({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-xs/relaxed break-all whitespace-pre-wrap text-red-700 dark:text-red-400">
      {text}
    </div>
  )
}

const roleLabels: Record<string, string> = {
  user: '用户',
  assistant: '助手',
  tool: '工具',
  system: '系统',
}

export function MessageList({ messages }: { messages: MessageView[] }) {
  return (
    <ol className="space-y-2">
      {messages.map((message, index) => (
        <li key={index} className="rounded-lg border border-border p-2.5">
          <Badge variant="outline" className="mb-1.5">{roleLabels[message.role] ?? message.role}</Badge>
          <div className="space-y-1.5">
            {message.blocks.map((block, blockIndex) => <MessageBlock key={blockIndex} block={block} />)}
          </div>
        </li>
      ))}
    </ol>
  )
}

function MessageBlock({ block }: { block: MessageBlockView }) {
  if (block.type === 'text')
    return <p className="text-xs/relaxed break-all whitespace-pre-wrap">{block.text}</p>
  if (block.type === 'image' || block.type === 'file') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
        {block.type === 'image' ? <ImageIcon className="size-3.5" /> : <FileIcon className="size-3.5" />}
        {block.type === 'image' ? '图片' : '文件'}
        {block.mimeType ? `（${block.mimeType}）` : ''}
      </span>
    )
  }
  if (block.type === 'tool-call') {
    return (
      <div className="rounded-md bg-muted/60 p-2 text-xs">
        <span className="font-medium">
          调用工具：
          {block.toolName ?? '未知工具'}
        </span>
        {block.args && <pre className="mt-1 max-h-40 overflow-auto break-all whitespace-pre-wrap text-muted-foreground">{JSON.stringify(block.args, null, 2)}</pre>}
      </div>
    )
  }
  if (block.type === 'tool-result') {
    return (
      <div className={cn('rounded-md p-2 text-xs', block.isError ? 'bg-red-500/10' : 'bg-muted/60')}>
        <span className="font-medium">
          工具结果：
          {block.toolName ?? '未知工具'}
          {block.isError ? '（错误）' : ''}
        </span>
        <pre className="mt-1 max-h-40 overflow-auto break-all whitespace-pre-wrap text-muted-foreground">
          {typeof block.result === 'string' ? block.result : JSON.stringify(block.result, null, 2)}
        </pre>
      </div>
    )
  }
  return <pre className="max-h-40 overflow-auto rounded-md bg-muted/60 p-2 text-xs break-all whitespace-pre-wrap text-muted-foreground">{JSON.stringify(block.raw, null, 2)}</pre>
}
