import type { ContextItemSnapshot, ContextTraceItemDetail, ContextTraceListItem } from '@ant-chat/shared'
import { ClipboardCopy, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { getAppEventSubscriptions } from '@/api/transports/appEventSubscriptions'
import { clipboardWrite } from '@/utils'
import { getContextTraceItem, getContextTraceLogPath, listContextTrace } from './api'
import { TurnDivider } from './Dividers'

// ================================================================
// 类型
// ================================================================

export interface ContextDiagnosticsPanelProps {
  conversationId?: string
  isOpen: boolean
  onClose: () => void
  width: number
  onWidthChange: (width: number) => void
}

interface LoadedTraceItem {
  listItem: ContextTraceListItem
  detail: ContextTraceItemDetail | null
  expanded: boolean
}

interface TurnMessages {
  turn: number
  messages: ContextItemSnapshot[]
}

// ================================================================
// Panel 组件
// ================================================================

const TAB_LABELS: Record<string, string> = {
  'message': 'Messages',
  'tool-definition': 'Tools',
  'model-settings': 'Settings',
}

export function ContextDiagnosticsPanel({
  conversationId,
  isOpen,
  onClose,
  width,
  onWidthChange,
}: ContextDiagnosticsPanelProps) {
  const [traceItems, setTraceItems] = useState<LoadedTraceItem[]>(() => [])
  const [loading, setLoading] = useState(false)
  const [cursor, setCursor] = useState<string | undefined>()
  const [hasMore, setHasMore] = useState(false)
  const [newContextCount, setNewContextCount] = useState(0)
  const [activeTab, setActiveTab] = useState<string>('message')

  const scrollRef = useRef<HTMLDivElement>(null)
  const isAtBottom = useRef(true)
  const resizeRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current)
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [])

  const loadLatest = useCallback(async () => {
    if (!conversationId)
      return
    setLoading(true)
    try {
      const result = await listContextTrace({ conversationId, limit: 200 })
      const items = result.items.map(item => ({ listItem: item, detail: null, expanded: false }))
      setTraceItems(items)
      setCursor(result.nextCursor)
      setHasMore(result.hasMore)

      // 预加载所有 trace item 详情
      result.items.forEach((item) => {
        getContextTraceItem(conversationId, item.requestId).then((detail) => {
          if (detail) {
            setTraceItems(p => p.map(t =>
              t.listItem.requestId === item.requestId ? { ...t, detail } : t,
            ))
          }
        })
      })
    }
    finally {
      setLoading(false)
    }
  }, [conversationId])

  const loadMore = useCallback(async () => {
    if (!conversationId || !cursor || loading)
      return
    setLoading(true)
    try {
      const result = await listContextTrace({ conversationId, before: cursor, limit: 200 })
      const newItems = result.items.map(item => ({ listItem: item, detail: null, expanded: false }))
      setTraceItems(prev => [...newItems, ...prev])
      setCursor(result.nextCursor)
      setHasMore(result.hasMore)

      result.items.forEach((item) => {
        getContextTraceItem(conversationId, item.requestId).then((detail) => {
          if (detail) {
            setTraceItems(p => p.map(t =>
              t.listItem.requestId === item.requestId ? { ...t, detail } : t,
            ))
          }
        })
      })
    }
    finally {
      setLoading(false)
    }
  }, [conversationId, cursor, loading])

  // 按 Turn 聚合所有 trace items（仅收集 message 类型）
  const turnGroups = useMemo(() => {
    const groups: TurnMessages[] = []
    let turnIdx = 0
    let prevStep = 0

    for (const item of traceItems) {
      const isNewTurn = turnIdx === 0 || item.listItem.step <= prevStep
      if (isNewTurn) {
        turnIdx++
        groups.push({ turn: turnIdx, messages: [] })
      }
      prevStep = item.listItem.step

      const detail = item.detail
      if (!detail)
        continue

      const items = detail.storage.kind === 'baseline'
        ? detail.storage.items
        : [...detail.storage.added]

      for (const ctxItem of items) {
        if (ctxItem.kind === 'message')
          groups[groups.length - 1].messages.push(ctxItem)
      }
    }

    return groups
  }, [traceItems])

  // 汇总全局上下文项（system prompt / tools / model settings），按 identity 去重并取最新版本
  const contextItems = useMemo(() => {
    const systemPrompts: ContextItemSnapshot[] = []
    const modelSettings: ContextItemSnapshot[] = []
    const toolDefs = new Map<string, ContextItemSnapshot>()

    const upsert = (arr: ContextItemSnapshot[], item: ContextItemSnapshot) => {
      const idx = arr.findIndex(s => s.identity.id === item.identity.id)
      if (idx >= 0)
        arr[idx] = item
      else
        arr.push(item)
    }

    for (const item of traceItems) {
      const detail = item.detail
      if (!detail)
        continue
      const storage = detail.storage
      const items = storage.kind === 'baseline' ? storage.items : storage.added
      for (const ci of items) {
        if (ci.kind === 'system-prompt')
          upsert(systemPrompts, ci)
        else if (ci.kind === 'model-settings')
          upsert(modelSettings, ci)
        else if (ci.kind === 'tool-definition')
          toolDefs.set(ci.identity.id, ci)
      }
    }

    return { systemPrompts, modelSettings, toolDefs: [...toolDefs.values()] }
  }, [traceItems])

  const availableTabs = useMemo(() => {
    const tabs = ['message']
    if (contextItems.toolDefs.length > 0)
      tabs.push('tool-definition')
    if (contextItems.modelSettings.length > 0)
      tabs.push('model-settings')
    return tabs
  }, [contextItems])

  const effectiveTab = availableTabs.includes(activeTab) ? activeTab : 'message'

  // 监听 SSE 更新
  useEffect(() => {
    if (!conversationId || !isOpen)
      return

    const eventSubscriptions = getAppEventSubscriptions()
    const handler = () => {
      if (isAtBottom.current)
        void loadLatest()
      else
        setNewContextCount(prev => prev + 1)
    }
    return eventSubscriptions.subscribe('agent:context-trace-updated', handler)
  }, [conversationId, isOpen, loadLatest])

  // 初始加载
  useEffect(() => {
    if (isOpen && conversationId)
      void loadLatest()
  }, [isOpen, conversationId, loadLatest])

  // 滚动检测
  useEffect(() => {
    const el = scrollRef.current
    if (!el)
      return
    const handleScroll = () => {
      const threshold = 100
      isAtBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < threshold
    }
    el.addEventListener('scroll', handleScroll)
    return () => el.removeEventListener('scroll', handleScroll)
  }, [])

  // 自动跟随底部
  useEffect(() => {
    if (isAtBottom.current)
      requestAnimationFrame(scrollToBottom)
  })

  const handleNewContextClick = useCallback(() => {
    scrollToBottom()
    setNewContextCount(0)
    void loadLatest()
  }, [scrollToBottom, loadLatest])

  const handleCopyLogPath = useCallback(async () => {
    if (!conversationId) {
      toast.error('请先选择一个会话')
      return
    }
    try {
      const logPath = await getContextTraceLogPath(conversationId)
      if (!logPath) {
        toast.error('上下文字迹未启用')
        return
      }
      await clipboardWrite({ text: logPath })
      toast.success('日志路径已复制')
    }
    catch {
      toast.error('获取日志路径失败')
    }
  }, [conversationId])

  // 浮层卡片：左侧边缘拖拽调节宽度
  const handleResizeDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const startX = e.clientX
    const startWidth = width
    const onMove = (ev: PointerEvent) => {
      const newWidth = Math.max(320, Math.min(window.innerWidth * 0.85, startWidth + startX - ev.clientX))
      onWidthChange(newWidth)
    }
    const onUp = () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.body.style.userSelect = ''
    }
    document.body.style.userSelect = 'none'
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    e.currentTarget.setPointerCapture(e.pointerId)
  }, [width, onWidthChange])

  if (!isOpen)
    return null

  return (
    <div
      className="absolute inset-y-2 right-2 z-20 flex flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl shadow-black/20"
      style={{ width: `${width}px`, minWidth: '320px', maxWidth: '90vw' }}
    >
      {/* 左侧边缘宽度调节手柄 */}
      <div
        ref={resizeRef}
        className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-ew-resize hover:bg-accent/30 active:bg-accent/50"
        onPointerDown={handleResizeDown}
      />

      {/* 标题栏 */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-xs font-semibold text-foreground/90">模型上下文</span>
          <span className="rounded-sm border border-border/60 px-1 py-0.5 text-[9px] font-bold tracking-wider text-muted-foreground/70">DEV</span>
          {turnGroups.length > 0 && (
            <span className="truncate text-[11px] text-muted-foreground">
              {turnGroups.length}
              {' '}
              Turn ·
              {traceItems.length}
              {' '}
              次请求
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleCopyLogPath}
            className="rounded-sm p-1 text-muted-foreground hover:bg-accent/10 hover:text-foreground"
            aria-label="复制日志路径"
            title="复制日志文件路径"
          >
            <ClipboardCopy className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm p-1 text-muted-foreground hover:bg-accent/10 hover:text-foreground"
            aria-label="关闭"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>

      {/* 全局 Tab 栏 */}
      <div className="flex shrink-0 gap-1 border-b border-border/40 px-2">
        {availableTabs.map(kind => (
          <button
            key={kind}
            type="button"
            onClick={() => setActiveTab(kind)}
            className={`border-b-2 px-2 py-1.5 text-[10px] font-bold tracking-wider uppercase transition-colors ${
              kind === effectiveTab
                ? 'border-foreground/80 text-foreground/90'
                : 'border-transparent text-muted-foreground/50 hover:text-muted-foreground/80'
            }`}
          >
            {TAB_LABELS[kind] || kind}
          </button>
        ))}
      </div>

      {/* 内容区 */}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-auto font-[inherit]"
        onScroll={(e) => {
          if (e.currentTarget.scrollTop < 50 && hasMore && !loading)
            void loadMore()
        }}
      >
        <div className="px-3 pt-2 pb-6 text-[13px] leading-relaxed">
          {loading && traceItems.length === 0 && (
            <div className="flex items-center justify-center py-12 text-xs text-muted-foreground">加载中…</div>
          )}
          {!loading && traceItems.length === 0 && (
            <div className="flex items-center justify-center py-12 text-xs text-muted-foreground">
              {conversationId ? '暂无上下文记录' : '请先选择一个会话'}
            </div>
          )}

          {/* Messages tab：system prompt 作为首条 + 各 turn 消息 + 最后一次回复 */}
          {effectiveTab === 'message' && (
            <div>
              {contextItems.systemPrompts.map(sp => (
                <SystemPromptMessage key={sp.identity.id} item={sp} />
              ))}

              {turnGroups.map(group => (
                <div key={group.turn} className="mb-3">
                  <TurnDivider turn={group.turn} />
                  {group.messages.map(msg => (
                    <ContextItemRow key={`${group.turn}-${msg.identity.id}`} item={msg} />
                  ))}
                </div>
              ))}
            </div>
          )}

          {/* Tools tab */}
          {effectiveTab === 'tool-definition' && (
            <div>
              {contextItems.toolDefs.map(item => (
                <ContextItemRow key={item.identity.id} item={item} />
              ))}
            </div>
          )}

          {/* Settings tab：仅模型参数，展开展示不折叠 */}
          {effectiveTab === 'model-settings' && (
            <ModelSettingsBlock items={contextItems.modelSettings} />
          )}
        </div>

        {newContextCount > 0 && (
          <div className="sticky bottom-3 flex justify-center">
            <button
              type="button"
              onClick={handleNewContextClick}
              className="rounded-full border border-border bg-surface px-3 py-1 text-[11px] text-muted-foreground shadow-sm hover:bg-accent/10 hover:text-foreground"
            >
              ↓
              {newContextCount}
              {' '}
              条新上下文
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ================================================================
// SystemPromptMessage — 作为消息列表首条展示的 system prompt
// ================================================================

function SystemPromptMessage({ item }: { item: ContextItemSnapshot }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="mb-1 border-b border-border/30">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-2 py-1 text-left hover:bg-accent/5"
      >
        <span className={`font-mono text-[10px] transition-transform ${open ? 'rotate-90' : ''} text-muted-foreground/40`}>▶</span>
        <span className="inline-flex items-center rounded-[3px] border border-chart-1/50 px-1 py-px text-[8px] leading-none font-bold tracking-wider text-chart-1 uppercase">
          system
        </span>
        <span className="min-w-0 truncate text-xs text-foreground/80">
          {(item.content || '').slice(0, 80).replace(/\n/g, ' ')}
        </span>
        {item.size != null && (
          <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/50">
            {item.size}
            {' '}
            chars
          </span>
        )}
      </button>

      {open && (
        <div className="scrollbar-thin mx-3 mb-2 max-h-80 overflow-auto rounded-lg border border-border/50 bg-code p-2.5 text-[11px] leading-relaxed text-code-foreground">
          <pre className="break-all whitespace-pre-wrap">{item.content}</pre>
        </div>
      )}
    </div>
  )
}

// ================================================================
// ContextItemRow — 单个上下文项行（message / tool-definition / model-settings）
// ================================================================

const STATUS_COLORS: Record<string, string> = {
  full: 'text-muted-foreground border-muted-foreground/40',
  added: 'text-chart-3 border-chart-3/50',
  updated: 'text-chart-4 border-chart-4/50',
  removed: 'text-destructive border-destructive/50',
}

// ================================================================
// ModelSettingsBlock — Settings tab 直接展开展示模型参数（不折叠）
// ================================================================

function ModelSettingsBlock({ items }: { items: ContextItemSnapshot[] }) {
  if (items.length === 0) {
    return (
      <div className="py-8 text-center text-[11px] text-muted-foreground">暂无模型参数</div>
    )
  }

  return (
    <div className="space-y-2">
      {items.map((item) => {
        const statusColor = STATUS_COLORS[item.status] || STATUS_COLORS.full
        const entries = item.settings ? Object.entries(item.settings) : []

        return (
          <div key={item.identity.id} className="overflow-hidden rounded-lg border border-border/40">
            <div className="flex items-center gap-2 border-b border-border/30 bg-accent/5 px-2 py-1">
              <span className={`inline-flex items-center rounded-[3px] border px-1 py-px text-[8px] leading-none font-bold tracking-wider uppercase ${statusColor}`}>
                {item.status}
              </span>
              <span className="text-[10px] text-muted-foreground/70">模型参数</span>
            </div>
            {entries.length > 0
              ? (
                  <div className="space-y-0.5 px-2.5 py-1.5 text-[11px] leading-relaxed">
                    {entries.map(([key, value]) => (
                      <div key={key} className="flex gap-2">
                        <span className="shrink-0 text-muted-foreground">
                          {key}
                          :
                        </span>
                        <span className="break-all text-foreground/80">{String(value)}</span>
                      </div>
                    ))}
                  </div>
                )
              : (
                  <div className="px-2.5 py-1.5 text-[10px] text-muted-foreground">无参数</div>
                )}
          </div>
        )
      })}
    </div>
  )
}

function ContextItemRow({ item }: { item: ContextItemSnapshot }) {
  const summary = buildSummary(item)
  const sizeLabel = buildSize(item)

  const [open, setOpen] = useState(false)

  return (
    <div className={`border-b border-border/30 last:border-b-0 ${open ? 'bg-accent/3' : ''}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-2 py-1 text-left hover:bg-accent/5"
      >
        <span className={`font-mono text-[10px] transition-transform ${open ? 'rotate-90' : ''} text-muted-foreground/40`}>▶</span>

        <span className="min-w-0 truncate text-xs text-foreground/80">
          {summary}
        </span>
        {sizeLabel && (
          <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/50">
            {sizeLabel}
          </span>
        )}
      </button>

      {open && (
        <div className="scrollbar-thin mx-3 mb-2 max-h-80 overflow-auto rounded-lg border border-border/50 bg-code p-2.5 text-[11px] leading-relaxed text-code-foreground">
          <ItemDetail item={item} />
        </div>
      )}
    </div>
  )
}

// ================================================================
// 详情内容
// ================================================================

function ItemDetail({ item }: { item: ContextItemSnapshot }) {
  if (item.kind === 'message') {
    const hasMultiTools = item.tools && item.tools.length > 0

    return (
      <div className="space-y-1">
        {item.content && (
          <div>
            <div className="text-[10px] text-muted-foreground">text:</div>
            <pre className="mt-0.5 break-all whitespace-pre-wrap">{item.content}</pre>
          </div>
        )}

        {hasMultiTools
          ? item.tools!.map((tc, idx) => (
              <div key={`${tc.toolCallId ?? idx}`}>
                <div className="mt-1 text-[10px] text-muted-foreground first:mt-0">
                  {tc.type === 'tool-call' ? 'tool-call:' : 'tool-result:'}
                  {tc.toolName}
                  {tc.isError ? ' ⚠️' : ''}
                </div>
                {tc.type === 'tool-call' && tc.args && (
                  <pre className="mt-0.5 rounded-sm border border-border/40 bg-code p-2 text-[10px] leading-relaxed break-all whitespace-pre-wrap text-code-foreground">
                    {JSON.stringify(tc.args, null, 2)}
                  </pre>
                )}
                {tc.type === 'tool-result' && tc.result !== undefined && (
                  <pre className="mt-0.5 rounded-sm border border-border/40 bg-code p-2 text-[10px] leading-relaxed break-all whitespace-pre-wrap text-code-foreground">
                    {tc.result}
                  </pre>
                )}
              </div>
            ))
          : (
              <>
                {item.toolName && item.toolArgs && (
                  <pre className="mt-0.5 rounded-sm border border-border/40 bg-code p-2 text-[10px] leading-relaxed break-all whitespace-pre-wrap text-code-foreground">
                    {JSON.stringify(item.toolArgs, null, 2)}
                  </pre>
                )}
                {item.toolName && item.toolResult !== undefined && (
                  <pre className="mt-0.5 rounded-sm border border-border/40 bg-code p-2 text-[10px] leading-relaxed break-all whitespace-pre-wrap text-code-foreground">
                    {item.toolResult}
                  </pre>
                )}
              </>
            )}
      </div>
    )
  }

  if (item.kind === 'tool-definition') {
    return (
      <div>
        <div className="mb-1 text-muted-foreground">
          {item.source && (
            <span className="mr-2">
              source:
              {item.source}
            </span>
          )}
          {item.serverName && (
            <span className="mr-2">
              server:
              {item.serverName}
            </span>
          )}
          <span>
            tool:
            {item.toolName}
          </span>
        </div>
        {item.content && <pre className="break-all whitespace-pre-wrap">{item.content}</pre>}
      </div>
    )
  }

  if (item.kind === 'model-settings' && item.settings) {
    return (
      <div className="space-y-0.5">
        {Object.entries(item.settings).map(([key, value]) => (
          <div key={key} className="flex gap-2">
            <span className="shrink-0 text-muted-foreground">
              {key}
              :
            </span>
            <span className="break-all">{String(value)}</span>
          </div>
        ))}
      </div>
    )
  }

  return <pre className="break-all whitespace-pre-wrap">{JSON.stringify(item, null, 2)}</pre>
}

// ================================================================
// 工具函数
// ================================================================

function buildSummary(item: ContextItemSnapshot): string {
  if (item.kind === 'message') {
    const roleLabel = item.role || '?'
    if (item.toolName) {
      const type = item.toolArgs ? 'tool-call' : item.toolResult !== undefined ? 'tool-result' : 'tool'
      const errMark = item.isError ? ' ⚠️' : ''
      const preview = item.toolArgs
        ? JSON.stringify(item.toolArgs).slice(0, 80).replace(/\n/g, ' ')
        : item.toolResult !== undefined
          ? item.toolResult.slice(0, 80).replace(/\n/g, ' ')
          : ''
      return `${roleLabel} · ${type}: ${item.toolName}${errMark}${preview ? ` · ${preview}` : ''}`
    }
    return `${roleLabel} ${(item.content || '').slice(0, 60).replace(/\n/g, ' ')}`
  }

  if (item.kind === 'tool-definition') {
    const src = item.source || 'native'
    const server = item.serverName ? `${item.serverName} · ` : ''
    return `${src} · ${server}${item.toolName}`
  }

  if (item.kind === 'model-settings' && item.settings) {
    const s = item.settings
    return `${s.model || ''} · temperature ${s.temperature ?? '?'} · maxOutputTokens ${s.maxOutputTokens ?? '?'}`
  }

  return ''
}

function buildSize(item: ContextItemSnapshot): string {
  if (item.kind === 'message') {
    if (item.tools && item.tools.length > 1)
      return `${item.tools.length} calls`
    if (item.toolArgs)
      return '1 call'
    if (item.toolResult !== undefined)
      return `${item.toolResult.length} chars`
    if (item.toolName)
      return '1 call'
    return `${item.size ?? 0} chars`
  }

  if (item.kind === 'tool-definition')
    return `${item.size ?? 0} chars`

  if (item.kind === 'model-settings')
    return `${item.size ?? 0} fields`

  return ''
}
