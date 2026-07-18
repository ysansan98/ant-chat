import type { AgentObservabilityEvidence, AgentTurnSummary, AgentTurnTimeline, AgentTurnTimelineItem } from '@ant-chat/shared'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@workspace/ui/components/collapsible'
import { Sheet, SheetContent } from '@workspace/ui/components/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@workspace/ui/components/tabs'
import { cn } from '@workspace/ui/lib/utils'
import { ActivityIcon, AlertTriangleIcon, ChevronRightIcon, XIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { observabilityApi } from '@/api/observabilityApi'
import { getAppEventSubscriptions } from '@/api/transports/appEventSubscriptions'
import { formatDuration, formatTime } from '@/utils'

interface ExecutionTracePanelProps {
  conversationId?: string
  isOpen: boolean
  focusTurnId?: string
  onClose: () => void
}

const NARROW_QUERY = '(max-width: 767px)'
const DEFAULT_PANEL_WIDTH = 520

type AvailableTurnSummary = Extract<AgentTurnSummary, { availability: 'available' }>

const statusLabels: Record<AvailableTurnSummary['status'], string> = {
  success: '成功',
  failed: '失败',
  cancelled: '已取消',
  interrupted: '已中断',
}

const itemLabels: Record<string, string> = {
  'model-request': '模型请求',
  'policy-decision': '策略判断',
  'tool-call': '工具调用',
  'compaction': '上下文压缩',
  'steering': '追加指令',
  'history-rewrite': '历史重写',
}

export function ExecutionTracePanel(props: ExecutionTracePanelProps) {
  const narrow = useMediaQuery(NARROW_QUERY)
  const [width, setWidth] = useState(DEFAULT_PANEL_WIDTH)

  if (!props.isOpen)
    return null

  if (narrow) {
    return (
      <Sheet open onOpenChange={open => !open && props.onClose()}>
        <SheetContent className="w-screen max-w-none gap-0 p-0 data-[side=right]:w-screen data-[side=right]:max-w-none" showCloseButton={false}>
          <TraceContent key={`${props.conversationId}:${props.focusTurnId ?? ''}`} {...props} onClose={props.onClose} />
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <aside
      className="relative flex h-full shrink-0 flex-col border-l border-border bg-background shadow-xl"
      style={{ width, minWidth: 360, maxWidth: '80vw' }}
      aria-label="执行轨迹"
    >
      <ResizeHandle width={width} onWidthChange={setWidth} />
      <TraceContent key={`${props.conversationId}:${props.focusTurnId ?? ''}`} {...props} onClose={props.onClose} />
    </aside>
  )
}

function TraceContent({ conversationId, isOpen, focusTurnId, onClose }: ExecutionTracePanelProps) {
  const [summaries, setSummaries] = useState<AgentTurnSummary[]>([])
  const [timelines, setTimelines] = useState<Record<string, AgentTurnTimeline | null>>({})
  const [timelineErrors, setTimelineErrors] = useState<Record<string, string>>({})
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [selected, setSelected] = useState<{ turnId: string, item: AgentTurnTimelineItem }>()
  const [evidence, setEvidence] = useState<AgentObservabilityEvidence | null>()
  const [evidenceError, setEvidenceError] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const evidenceRequestId = useRef(0)
  const summaryRequestId = useRef(0)
  const timelineRequestIds = useRef<Record<string, number>>({})

  const loadTimeline = useCallback(async (turnId: string) => {
    if (!conversationId)
      return
    const requestId = (timelineRequestIds.current[turnId] ?? 0) + 1
    timelineRequestIds.current[turnId] = requestId
    setTimelineErrors(current => omitKey(current, turnId))
    try {
      const timeline = await observabilityApi.getTurnTimeline(conversationId, turnId)
      if (requestId === timelineRequestIds.current[turnId])
        setTimelines(current => ({ ...current, [turnId]: timeline }))
    }
    catch (cause) {
      if (requestId === timelineRequestIds.current[turnId])
        setTimelineErrors(current => ({ ...current, [turnId]: toRequestError('读取时间线失败', cause) }))
    }
  }, [conversationId])

  const loadSummaries = useCallback(async (selectDefault: boolean) => {
    if (!conversationId || !isOpen)
      return
    const requestId = ++summaryRequestId.current
    setLoading(true)
    setError(undefined)
    try {
      const items = await observabilityApi.listTurns(conversationId)
      if (requestId !== summaryRequestId.current)
        return
      setSummaries(items)
      if (selectDefault) {
        const initialTurnId = focusTurnId ?? items[0]?.turnId
        const initialSummary = items.find(item => item.turnId === initialTurnId)
        if (initialTurnId && initialSummary?.availability === 'available') {
          setExpanded(current => new Set(current).add(initialTurnId))
          void loadTimeline(initialTurnId)
        }
      }
    }
    catch (cause) {
      if (requestId === summaryRequestId.current)
        setError(toTraceError(cause))
    }
    finally {
      if (requestId === summaryRequestId.current)
        setLoading(false)
    }
  }, [conversationId, focusTurnId, isOpen, loadTimeline])

  useEffect(() => {
    if (!isOpen || !conversationId)
      return
    void loadSummaries(true)
  }, [conversationId, isOpen, loadSummaries])

  useEffect(() => {
    if (!isOpen || !conversationId)
      return
    const subscriptions = getAppEventSubscriptions()
    return subscriptions.subscribe('observability:changed', (payload) => {
      if (payload.conversationId === conversationId)
        void loadSummaries(false)
    })
  }, [conversationId, isOpen, loadSummaries])

  async function toggleTurn(turnId: string) {
    const willOpen = !expanded.has(turnId)
    setExpanded((current) => {
      const next = new Set(current)
      if (willOpen)
        next.add(turnId)
      else
        next.delete(turnId)
      return next
    })
    if (willOpen && conversationId && !(turnId in timelines))
      await loadTimeline(turnId)
  }

  async function inspectItem(turnId: string, item: AgentTurnTimelineItem) {
    const requestId = ++evidenceRequestId.current
    setSelected({ turnId, item })
    setEvidence(undefined)
    setEvidenceError(undefined)
    if (!conversationId)
      return
    try {
      const result = await observabilityApi.getEvidence(conversationId, turnId, item.recordId)
      if (requestId === evidenceRequestId.current)
        setEvidence(result)
    }
    catch (cause) {
      if (requestId === evidenceRequestId.current)
        setEvidenceError(toRequestError('读取原始证据失败', cause))
    }
  }

  function closeEvidence() {
    evidenceRequestId.current += 1
    setSelected(undefined)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
        <ActivityIcon className="size-4 text-primary" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold">执行轨迹</h2>
          <p className="text-xs text-muted-foreground">Agent Turn 原始执行证据</p>
        </div>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="关闭执行轨迹" onClick={onClose}>
          <XIcon />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-3 p-3">
          {loading && summaries.length === 0 && <EmptyState>正在读取 Trace…</EmptyState>}
          {error && <EmptyState tone="warning">{error}</EmptyState>}
          {!loading && !error && !conversationId && <EmptyState>请先选择会话</EmptyState>}
          {!loading && !error && conversationId && summaries.length === 0 && <EmptyState>此会话没有已采集的 Trace</EmptyState>}
          {summaries.map(summary => (
            <TurnCard
              key={summary.turnId}
              summary={summary}
              timeline={timelines[summary.turnId]}
              timelineError={timelineErrors[summary.turnId]}
              open={expanded.has(summary.turnId)}
              selectedRecordId={selected?.turnId === summary.turnId ? selected.item.recordId : undefined}
              onToggle={() => void toggleTurn(summary.turnId)}
              onInspect={item => void inspectItem(summary.turnId, item)}
            />
          ))}
        </div>
      </div>

      {selected && (
        <EvidenceDetails selection={selected} evidence={evidence} error={evidenceError} onClose={closeEvidence} />
      )}
    </div>
  )
}

function TurnCard(props: {
  summary: AgentTurnSummary
  timeline?: AgentTurnTimeline | null
  timelineError?: string
  open: boolean
  selectedRecordId?: string
  onToggle: () => void
  onInspect: (item: AgentTurnTimelineItem) => void
}) {
  const { summary, timeline } = props
  if (summary.availability !== 'available') {
    const availabilityLabel = {
      'expired': 'Trace 已过期',
      'unsupported': 'Trace 版本不受支持',
      'not-collected': '未采集 Trace',
    }[summary.availability]
    return (
      <div className="rounded-xl border border-dashed border-border bg-card p-3">
        <div className="font-medium">
          Turn
          {' '}
          {summary.turnId}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{summary.message ?? availabilityLabel}</p>
      </div>
    )
  }
  return (
    <Collapsible open={props.open} onOpenChange={props.onToggle} className="overflow-hidden rounded-xl border border-border bg-card">
      <CollapsibleTrigger render={(
        <button type="button" className="flex w-full items-center gap-3 p-3 text-left" />
      )}
      >
        <ChevronRightIcon className={cn('size-4 shrink-0 text-muted-foreground transition-transform', props.open && 'rotate-90')} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">
              Turn
              {' '}
              {summary.turnId}
            </span>
            <Badge variant="outline">{summary.source.type === 'automation' ? 'Automation' : '交互'}</Badge>
            <Badge variant={summary.status === 'success' ? 'secondary' : 'destructive'}>{statusLabels[summary.status]}</Badge>
          </div>
          <div className="mt-1 flex gap-2 text-xs text-muted-foreground">
            <span>{formatTime(summary.startedAt)}</span>
            {summary.durationMs != null && <span>{formatDuration(summary.durationMs)}</span>}
            <span>
              {summary.spanCounts.modelRequests + summary.spanCounts.policyDecisions + summary.spanCounts.toolCalls}
              {' '}
              个步骤
            </span>
          </div>
        </div>
        {summary.completeness === 'incomplete' && (
          <span className="inline-flex items-center gap-1 text-xs text-amber-600">
            <AlertTriangleIcon className="size-3.5" />
            Trace 不完整
          </span>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-t border-border p-3">
          {props.timelineError && <p className="py-4 text-center text-xs text-destructive">{props.timelineError}</p>}
          {!props.timelineError && timeline === undefined && <p className="py-4 text-center text-xs text-muted-foreground">正在加载时间线…</p>}
          {timeline === null && <p className="py-4 text-center text-xs text-muted-foreground">Trace 已过期</p>}
          {!props.timelineError && timeline && <Waterfall timeline={timeline} selectedRecordId={props.selectedRecordId} onInspect={props.onInspect} />}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function Waterfall({ timeline, selectedRecordId, onInspect }: {
  timeline: AgentTurnTimeline
  selectedRecordId?: string
  onInspect: (item: AgentTurnTimelineItem) => void
}) {
  if (timeline.summary.availability !== 'available')
    return <p className="py-4 text-center text-xs text-muted-foreground">Trace 不可用</p>
  const total = Math.max(1, (timeline.summary.endedAt ?? Date.now()) - timeline.summary.startedAt)
  return (
    <div className="space-y-1.5" aria-label="Turn 时间线">
      {timeline.items.map((item) => {
        const startedAt = item.type === 'span' ? item.startedAt : item.recordedAt
        const left = Math.min(88, Math.max(0, ((startedAt - timeline.summary.startedAt) / total) * 100))
        const width = item.type === 'span' ? Math.max(8, Math.min(100 - left, ((item.durationMs ?? 1) / total) * 100)) : 2
        const kind = item.kind
        return (
          <button
            key={item.recordId}
            type="button"
            aria-label={itemLabels[kind]}
            className={cn('grid w-full grid-cols-[4.5rem_1fr_3.5rem] items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent', selectedRecordId === item.recordId && 'bg-accent')}
            onClick={() => onInspect(item)}
          >
            <span className="text-muted-foreground tabular-nums">
              +
              {formatOffset(startedAt - timeline.summary.startedAt)}
            </span>
            <span className="relative h-7 overflow-hidden rounded-sm bg-muted">
              <span
                className={cn('absolute inset-y-0 rounded-sm', waterfallColor(kind))}
                style={{ left: `${left}%`, width: `${width}%` }}
              />
              <span className="relative z-1 flex h-full items-center px-2 font-medium">{itemLabels[kind]}</span>
            </span>
            <span className="text-right text-muted-foreground tabular-nums">
              {item.type === 'span' && item.durationMs != null ? formatDuration(item.durationMs) : '事件'}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function EvidenceDetails({ selection, evidence, error, onClose }: {
  selection: { turnId: string, item: AgentTurnTimelineItem }
  evidence: AgentObservabilityEvidence | null | undefined
  error?: string
  onClose: () => void
}) {
  const developerView = useMemo(() => ({ turnId: selection.turnId, ...selection.item }), [selection])
  return (
    <section className="max-h-[48%] shrink-0 overflow-auto border-t border-border bg-background p-3" aria-label="步骤证据">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">{itemLabels[selection.item.kind]}</h3>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="关闭步骤证据" onClick={onClose}><XIcon /></Button>
      </div>
      {error && <p className="mb-2 text-xs text-destructive">{error}</p>}
      <Tabs defaultValue="overview">
        <TabsList variant="line">
          <TabsTrigger value="overview">概览</TabsTrigger>
          <TabsTrigger value="developer">开发者视图</TabsTrigger>
          <TabsTrigger value="raw">原始证据</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="space-y-2 py-2 text-xs">
          <EvidenceRow label="类型" value={itemLabels[selection.item.kind]} />
          <EvidenceRow label="记录 ID" value={selection.item.recordId} />
          {selection.item.type === 'span' && <EvidenceRow label="状态" value={selection.item.status ?? '进行中'} />}
        </TabsContent>
        <TabsContent value="developer" className="py-2">
          <JsonEvidence value={developerView} />
        </TabsContent>
        <TabsContent value="raw" className="py-2">
          {!error && evidence === undefined && <p className="text-xs text-muted-foreground">正在读取原始证据…</p>}
          {!error && evidence === null && <p className="text-xs text-muted-foreground">原始证据不可用</p>}
          {!error && evidence && <JsonEvidence value={evidence.records} />}
        </TabsContent>
      </Tabs>
    </section>
  )
}

function EvidenceRow({ label, value }: { label: string, value: string }) {
  return (
    <div className="grid grid-cols-[5rem_1fr] gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="break-all">{value}</span>
    </div>
  )
}

function JsonEvidence({ value }: { value: unknown }) {
  return <pre className="max-h-80 overflow-auto rounded-lg bg-code p-3 text-xs/relaxed break-all whitespace-pre-wrap text-code-foreground">{JSON.stringify(value, null, 2)}</pre>
}

function EmptyState({ children, tone }: { children: React.ReactNode, tone?: 'warning' }) {
  return <div className={cn('rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground', tone === 'warning' && 'border-amber-500/40 text-amber-700')}>{children}</div>
}

function ResizeHandle({ width, onWidthChange }: { width: number, onWidthChange: (width: number) => void }) {
  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    const startX = event.clientX
    const startWidth = width
    const move = (next: PointerEvent) => onWidthChange(Math.max(360, Math.min(window.innerWidth * 0.8, startWidth + startX - next.clientX)))
    const finish = () => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', finish)
      document.body.style.userSelect = ''
    }
    document.body.style.userSelect = 'none'
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', finish)
  }
  return <div className="absolute inset-y-0 -left-1 z-10 w-2 cursor-ew-resize hover:bg-primary/20" onPointerDown={handlePointerDown} />
}

function useMediaQuery(query: string): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    const media = window.matchMedia(query)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [query])
  const snapshot = useCallback(() => window.matchMedia(query).matches, [query])
  return useSyncExternalStore(subscribe, snapshot, () => false)
}

function formatOffset(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1)}s`
}

function waterfallColor(kind: AgentTurnTimelineItem['kind']): string {
  if (kind === 'model-request')
    return 'bg-indigo-500/45'
  if (kind === 'policy-decision')
    return 'bg-amber-500/45'
  if (kind === 'tool-call')
    return 'bg-cyan-500/45'
  return 'bg-violet-500/45'
}

function toTraceError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/unsupported|schema version|不支持/i.test(message))
    return 'Trace 版本不受支持'
  return `读取 Trace 失败：${message}`
}

function toRequestError(prefix: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return `${prefix}：${message}`
}

function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record }
  delete next[key]
  return next
}

export type { ExecutionTracePanelProps }
