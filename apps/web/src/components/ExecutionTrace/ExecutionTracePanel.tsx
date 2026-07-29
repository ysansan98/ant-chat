import type { AgentObservabilityEvidence, AgentTurnSummary, AgentTurnTimeline, AgentTurnTimelineItem } from '@ant-chat/shared'
import type { ToolDefinitionView } from './evidenceModel'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@workspace/ui/components/collapsible'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { Sheet, SheetContent } from '@workspace/ui/components/sheet'
import { Spinner } from '@workspace/ui/components/spinner'
import { cn } from '@workspace/ui/lib/utils'
import { ActivityIcon, AlertTriangleIcon, ChevronRightIcon, LoaderIcon, XIcon } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { observabilityApi } from '@/api/observabilityApi'
import { getAppEventSubscriptions } from '@/api/transports/appEventSubscriptions'
import { formatDuration, formatTime } from '@/utils'
import { EvidenceDetails } from './EvidenceDetails'
import { itemLabels, parseEvidence } from './evidenceModel'
import { CodeBlock, CopyButton } from './evidencePrimitives'

interface ExecutionTracePanelProps {
  conversationId?: string
  isOpen: boolean
  focusTurnId?: string
  onClose: () => void
}

const NARROW_QUERY = '(max-width: 767px)'
const DEFAULT_PANEL_WIDTH = 520

type AvailableTurnSummary = Extract<AgentTurnSummary, { availability: 'available' }>
type CompletedTurnSummary = Extract<AvailableTurnSummary, { lifecycle: 'completed' }>

interface TurnContext {
  systemPrompt?: string
  tools: ToolDefinitionView[]
}

const statusLabels: Record<CompletedTurnSummary['status'], string> = {
  success: '成功',
  failed: '失败',
  cancelled: '已取消',
  interrupted: '已中断',
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
  const [turnContexts, setTurnContexts] = useState<Record<string, TurnContext | null>>({})
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [selected, setSelected] = useState<{ turnId: string, item: AgentTurnTimelineItem }>()
  const [evidence, setEvidence] = useState<AgentObservabilityEvidence | null>()
  const [evidenceError, setEvidenceError] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const evidenceRequestIdRef = useRef(0)
  const summaryRequestIdRef = useRef(0)
  const timelineRequestIdsRef = useRef<Record<string, number>>({})

  const loadTimeline = useCallback(async (turnId: string): Promise<AgentTurnTimeline | null> => {
    if (!conversationId)
      return null
    const requestId = (timelineRequestIdsRef.current[turnId] ?? 0) + 1
    timelineRequestIdsRef.current[turnId] = requestId
    setTimelineErrors(current => omitKey(current, turnId))
    try {
      const timeline = await observabilityApi.getTurnTimeline(conversationId, turnId)
      if (requestId === timelineRequestIdsRef.current[turnId]) {
        setTimelines(current => ({ ...current, [turnId]: timeline }))
        return timeline
      }
      return null
    }
    catch (cause) {
      if (requestId === timelineRequestIdsRef.current[turnId])
        setTimelineErrors(current => ({ ...current, [turnId]: toRequestError('读取时间线失败', cause) }))
      return null
    }
  }, [conversationId])

  const loadSummaries = useCallback(async (selectDefault: boolean) => {
    if (!conversationId || !isOpen)
      return
    const requestId = ++summaryRequestIdRef.current
    setLoading(true)
    setError(undefined)
    try {
      const items = await observabilityApi.listTurns(conversationId)
      if (requestId !== summaryRequestIdRef.current)
        return
      setSummaries(items)
      if (selectDefault) {
        const initialSummary = focusTurnId
          ? items.find(item => item.turnId === focusTurnId)
          : items.find(item => item.availability === 'available' && item.lifecycle === 'completed')
        if (initialSummary?.availability === 'available' && initialSummary.lifecycle === 'completed') {
          setExpanded(current => new Set(current).add(initialSummary.turnId))
          void loadTimeline(initialSummary.turnId)
        }
      }
    }
    catch (cause) {
      if (requestId === summaryRequestIdRef.current)
        setError(toTraceError(cause))
    }
    finally {
      if (requestId === summaryRequestIdRef.current)
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
    return getAppEventSubscriptions().subscribe('observability:turn-settled', (payload) => {
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
    if (willOpen && conversationId) {
      const timeline = await (turnId in timelines ? Promise.resolve(timelines[turnId]) : loadTimeline(turnId))
      if (timeline && !(turnId in turnContexts))
        await loadTurnContext(turnId, timeline)
    }
  }

  async function inspectItem(turnId: string, item: AgentTurnTimelineItem) {
    const requestId = ++evidenceRequestIdRef.current
    setSelected({ turnId, item })
    setEvidence(undefined)
    setEvidenceError(undefined)
    if (!conversationId)
      return
    try {
      const result = await observabilityApi.getEvidence(conversationId, turnId, item.recordId)
      if (requestId === evidenceRequestIdRef.current)
        setEvidence(result)
    }
    catch (cause) {
      if (requestId === evidenceRequestIdRef.current)
        setEvidenceError(toRequestError('读取原始证据失败', cause))
    }
  }

  function closeEvidence() {
    evidenceRequestIdRef.current += 1
    setSelected(undefined)
  }

  async function loadTurnContext(turnId: string, timeline: AgentTurnTimeline) {
    const firstModelRequest = timeline.items.find(
      (item): item is Extract<AgentTurnTimelineItem, { type: 'span' }> =>
        item.type === 'span' && item.kind === 'model-request',
    )
    if (!firstModelRequest || !conversationId) {
      setTurnContexts(current => ({ ...current, [turnId]: null }))
      return
    }
    try {
      const evidence = await observabilityApi.getEvidence(conversationId, turnId, firstModelRequest.recordId)
      if (!evidence) {
        setTurnContexts(current => ({ ...current, [turnId]: null }))
        return
      }
      const view = parseEvidence(firstModelRequest, evidence)
      if (view.type !== 'model-request') {
        setTurnContexts(current => ({ ...current, [turnId]: null }))
        return
      }
      setTurnContexts(current => ({
        ...current,
        [turnId]: {
          systemPrompt: view.systemPrompt,
          tools: view.tools,
        },
      }))
    }
    catch {
      setTurnContexts(current => ({ ...current, [turnId]: null }))
    }
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
          {loading && summaries.length === 0 && <div className="flex justify-center py-4"><Spinner /></div>}
          {error && <EmptyState title={error} />}
          {!loading && !error && !conversationId && <EmptyState title="请先选择会话" />}
          {!loading && !error && conversationId && summaries.length === 0 && <EmptyState title="此会话没有已采集的 Trace" />}
          {summaries.map(summary => (
            <TurnCard
              key={summary.turnId}
              summary={summary}
              timeline={timelines[summary.turnId]}
              timelineError={timelineErrors[summary.turnId]}
              turnContext={turnContexts[summary.turnId]}
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
  turnContext?: TurnContext | null
  open: boolean
  selectedRecordId?: string
  onToggle: () => void
  onInspect: (item: AgentTurnTimelineItem) => void
}) {
  const { summary, timeline, turnContext } = props
  const traceFilePath = 'traceFilePath' in summary ? summary.traceFilePath : undefined
  if (summary.availability !== 'available') {
    const availabilityLabel = {
      'expired': 'Trace 已过期',
      'unsupported': 'Trace 版本不受支持',
      'not-collected': '未采集 Trace',
    }[summary.availability]
    return (
      <div className="rounded-xl border border-dashed border-border bg-card p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="font-medium">
            Turn
            {' '}
            {summary.turnId}
          </div>
          {traceFilePath && <CopyButton text={() => traceFilePath} label="复制路径" />}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{summary.message ?? availabilityLabel}</p>
      </div>
    )
  }
  if (summary.lifecycle === 'collecting') {
    return (
      <div className="rounded-xl border border-border bg-card p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">
              Turn
              {' '}
              {summary.turnId}
            </span>
            <Badge variant="outline">{summary.source.type === 'automation' ? 'Automation' : '交互'}</Badge>
            <Badge variant="secondary" className="gap-1">
              <LoaderIcon className="size-3 animate-spin" />
              执行中
            </Badge>
          </div>
          {traceFilePath && <CopyButton text={() => traceFilePath} label="复制路径" />}
        </div>
        <div className="mt-1 flex gap-2 text-xs text-muted-foreground">
          <span>{formatTime(summary.startedAt)}</span>
          <span>
            {summary.spanCounts.modelRequests + summary.spanCounts.policyDecisions + summary.spanCounts.toolCalls}
            {' '}
            个步骤
          </span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">执行中，完成后可查看</p>
      </div>
    )
  }
  return (
    <Collapsible open={props.open} onOpenChange={props.onToggle} className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center gap-3 p-3">
        <CollapsibleTrigger render={(
          <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" />
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
            {summary.errorSummary && <p className="mt-1 text-xs text-destructive">{summary.errorSummary}</p>}
          </div>
          {summary.completeness === 'incomplete' && (
            <span className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangleIcon className="size-3.5" />
              Trace 不完整
            </span>
          )}
        </CollapsibleTrigger>
        {traceFilePath && <CopyButton text={() => traceFilePath} label="复制路径" className="shrink-0 self-start" />}
      </div>
      <CollapsibleContent>
        <div className="border-t border-border p-3">
          {turnContext && (turnContext.systemPrompt || turnContext.tools.length > 0) && (
            <TurnContextSection turnContext={turnContext} />
          )}
          {props.timelineError && <p className="py-4 text-center text-xs text-destructive">{props.timelineError}</p>}
          {!props.timelineError && timeline === undefined && <div className="flex justify-center py-4"><Spinner /></div>}
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
  const endedAt = timeline.summary.endedAt
  const total = endedAt != null
    ? Math.max(1, endedAt - timeline.summary.startedAt)
    : Math.max(1, (() => {
        let latest = timeline.summary.startedAt
        for (const item of timeline.items) {
          const ts = item.type === 'span' ? (item.endedAt ?? item.startedAt) : item.recordedAt
          if (ts > latest)
            latest = ts
        }
        return latest - timeline.summary.startedAt
      })())
  return (
    <div className="space-y-0.5" aria-label="Turn 时间线">
      {timeline.items.map((item) => {
        const startedAt = item.type === 'span' ? item.startedAt : item.recordedAt
        const offset = Math.max(0, startedAt - timeline.summary.startedAt)
        const left = Math.min(92, (offset / total) * 100)
        const width = item.type === 'span'
          ? item.durationMs != null ? Math.max(item.durationMs === 0 ? 0 : 2, Math.min(100 - left, (item.durationMs / total) * 100)) : 0
          : 3
        return (
          <button
            key={item.recordId}
            type="button"
            aria-label={itemLabels[item.kind]}
            className={cn('grid w-full grid-cols-[4.5rem_1fr_4rem] items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent', selectedRecordId === item.recordId && 'bg-accent')}
            onClick={() => onInspect(item)}
          >
            <span className="text-muted-foreground tabular-nums">
              +
              {formatOffset(offset)}
            </span>
            <span className="relative h-7 overflow-hidden rounded-sm bg-muted">
              <span
                className={cn('absolute inset-y-0', waterfallColor(item.kind))}
                style={{ left: `${left}%`, width: `${width}%` }}
              />
              <span className="relative z-1 flex h-full items-center gap-1.5 px-2">
                <span className="shrink-0 rounded-sm bg-background/70 px-1 py-0.5 text-[11px] leading-none font-medium">
                  {itemLabels[item.kind]}
                </span>
                {item.type === 'span' && item.summary && (
                  <span className="truncate">{item.summary}</span>
                )}
              </span>
            </span>
            <span className="flex items-center justify-end gap-1 text-muted-foreground tabular-nums">
              {item.type === 'span' && item.durationMs != null
                ? formatDuration(item.durationMs)
                : item.type === 'span'
                  ? '未结束'
                  : '事件'}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function TurnContextSection({ turnContext }: { turnContext: TurnContext }) {
  const [open, setOpen] = useState(false)
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mb-3 rounded-lg border border-border">
      <CollapsibleTrigger render={(
        <button type="button" className="flex w-full items-center gap-2 p-2.5 text-left text-xs">
          <ChevronRightIcon className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`} />
          <span className="font-medium">Turn 上下文</span>
          <span className="text-muted-foreground">
            {[
              turnContext.systemPrompt && '系统提示',
              turnContext.tools.length > 0 && `${turnContext.tools.length} 个工具`,
            ].filter(Boolean).join(' · ')}
          </span>
        </button>
      )}
      />
      <CollapsibleContent>
        <div className="space-y-3 border-t border-border p-2.5">
          {turnContext.systemPrompt && (
            <div className="space-y-1">
              <h5 className="text-xs font-medium text-muted-foreground">系统提示</h5>
              <CodeBlock text={turnContext.systemPrompt} />
            </div>
          )}
          {turnContext.tools.length > 0 && (
            <div className="space-y-1">
              <h5 className="text-xs font-medium text-muted-foreground">
                可用工具（
                {turnContext.tools.length}
                ）
              </h5>
              <div className="space-y-1">
                {turnContext.tools.map(tool => (
                  <div key={`${tool.serverName ?? ''}:${tool.name}`} className="rounded-sm border border-border px-2.5 py-1.5 text-xs">
                    <span className="font-medium">{tool.name}</span>
                    {tool.serverName && <span className="ml-1.5 text-muted-foreground">{tool.serverName}</span>}
                    {tool.description && (
                      <span className="ml-1.5 text-muted-foreground">
                        —
                        {tool.description}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
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
    return 'bg-chart-1/45'
  if (kind === 'policy-decision')
    return 'bg-chart-4/45'
  if (kind === 'tool-call')
    return 'bg-chart-2/45'
  return 'bg-chart-5/45'
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
