import type { AgentObservabilityEvidence, AgentObservabilityRecord, AgentTurnTimelineItem } from '@ant-chat/shared'
import { Button } from '@workspace/ui/components/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@workspace/ui/components/tabs'
import { XIcon } from 'lucide-react'
import { useMemo } from 'react'
import { formatDuration, formatTime } from '@/utils'
import { EvidenceDetailView } from './EvidenceDeveloperView'
import { itemLabels, parseEvidence } from './evidenceModel'
import { CopyButton, StatusBadge } from './evidencePrimitives'
import { JsonTree } from './JsonTree'

const recordTypeLabels: Record<AgentObservabilityRecord['recordType'], string> = {
  'trace-started': 'Trace 开始',
  'span-started': 'Span 开始 · 输入',
  'span-completed': 'Span 完成 · 输出',
  'context-event': '上下文事件',
  'trace-incomplete': '不完整标记',
  'trace-completed': 'Trace 完成',
}

/** 步骤证据抽屉：概览（结果摘要）/ 开发者视图（完整输入输出）/ 原始证据（审计 JSON）。 */
export function EvidenceDetails({ selection, evidence, error, onClose }: {
  selection: { turnId: string, item: AgentTurnTimelineItem }
  evidence: AgentObservabilityEvidence | null | undefined
  error?: string
  onClose: () => void
}) {
  const loading = !error && evidence === undefined
  const view = useMemo(
    () => (loading ? undefined : parseEvidence(selection.item, evidence ?? null)),
    [loading, selection.item, evidence],
  )
  const status = view && 'status' in view ? view.status : (selection.item.type === 'span' ? selection.item.status : undefined)
  const pending = view && 'pending' in view ? view.pending : (selection.item.type === 'span' && selection.item.status == null)
  const durationMs = selection.item.type === 'span' ? selection.item.durationMs : undefined

  return (
    <section className="flex max-h-1/2 min-h-44 shrink-0 flex-col border-t border-border bg-background" aria-label="步骤证据">
      <header className="flex items-center gap-2 px-3 pt-2.5">
        <h3 className="shrink-0 text-sm font-semibold">{itemLabels[selection.item.kind]}</h3>
        {selection.item.type === 'span' && <StatusBadge status={status} pending={pending} />}
        {durationMs != null && <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{formatDuration(durationMs)}</span>}
        <div className="min-w-0 flex-1" />
        <Button type="button" variant="ghost" size="icon-sm" aria-label="关闭步骤证据" onClick={onClose}><XIcon /></Button>
      </header>
      {error && <p className="px-3 pt-1 text-xs text-destructive">{error}</p>}
      <Tabs defaultValue="detail" className="mt-1 flex min-h-0 flex-1 flex-col px-3 pb-2">
        <TabsList variant="line" className="shrink-0">
          <TabsTrigger value="detail">详情</TabsTrigger>
          <TabsTrigger value="raw">原始证据</TabsTrigger>
        </TabsList>
        <TabsContent value="detail" className="min-h-0 overflow-y-auto py-2.5">
          {loading ? <EvidenceSkeleton /> : view && <EvidenceDetailView view={view} />}
        </TabsContent>
        <TabsContent value="raw" className="min-h-0 overflow-y-auto py-2.5">
          {!error && evidence === undefined && <p className="text-xs text-muted-foreground">正在读取原始证据…</p>}
          {!error && evidence === null && <p className="text-xs text-muted-foreground">原始证据不可用</p>}
          {!error && evidence && (
            <div className="space-y-3">
              {evidence.records.map(record => (
                <div key={record.recordId} className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium">{recordTypeLabels[record.recordType]}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      #
                      {record.sequence}
                      {' · '}
                      {formatTime(record.recordedAt)}
                    </span>
                    <CopyButton text={() => JSON.stringify(record, null, 2)} label="复制该记录" />
                  </div>
                  {/* 审计 Tab 默认全展开，仅超长数组（如流式 chunks）自动折叠，保持与旧版"完整可见"语义一致 */}
                  <JsonTree value={record} expandDepth={Number.POSITIVE_INFINITY} />
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </section>
  )
}

function EvidenceSkeleton() {
  return (
    <div className="animate-pulse space-y-2.5" aria-label="正在加载证据">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div className="h-12 rounded-lg bg-muted" />
        <div className="h-12 rounded-lg bg-muted" />
        <div className="h-12 rounded-lg bg-muted" />
      </div>
      <div className="h-20 rounded-lg bg-muted" />
      <div className="h-4 w-1/2 rounded-sm bg-muted" />
    </div>
  )
}
