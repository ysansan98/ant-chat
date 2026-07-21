import type { ContextEventView, EvidenceView, ModelRequestView, PolicyDecisionView, ToolCallEvidenceView } from './evidenceModel'
import { Badge } from '@workspace/ui/components/badge'
import { ShieldAlertIcon, ShieldCheckIcon, ShieldXIcon } from 'lucide-react'
import { formatDuration } from '@/utils'
import { agentModeLabel, policyBasisLabel } from './evidenceModel'
import { ErrorBlock, ExpandableText, KeyValueList, Section, StatGrid } from './evidencePrimitives'

/** 概览 Tab：回答"这一步做了什么、结果如何"，只保留决策相关的关键信息。 */
export function EvidenceOverview({ view }: { view: EvidenceView }) {
  if (view.type === 'model-request')
    return <ModelRequestOverview view={view} />
  if (view.type === 'tool-call')
    return <ToolCallOverview view={view} />
  if (view.type === 'policy-decision')
    return <PolicyDecisionOverview view={view} />
  if (view.type === 'context-event')
    return <ContextEventOverview view={view} />
  return (
    <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
      {view.reason}
      ，请切换到「原始证据」查看完整记录。
    </div>
  )
}

function ModelRequestOverview({ view }: { view: ModelRequestView }) {
  const stats = [
    { label: '模型', value: view.model ?? '未知' },
    { label: '耗时', value: formatOptionalDuration(view.responseDurationMs ?? durationOf(view)) },
    { label: '输入 Tokens', value: formatOptionalNumber(view.usage?.inputTokens) },
    { label: '输出 Tokens', value: formatOptionalNumber(view.usage?.outputTokens) },
    { label: '结束原因', value: view.finishReason ?? '—' },
    { label: '请求工具数', value: String(view.toolCalls.length) },
  ]
  return (
    <div className="space-y-3">
      <StatGrid items={stats} />
      {view.errorText && <ErrorBlock text={view.errorText} />}
      {view.pending && !view.errorText && <p className="text-xs text-amber-600">模型请求缺少结束记录</p>}
      {view.responseText && (
        <Section title="回复">
          <div className="rounded-lg bg-muted/60 p-3">
            <ExpandableText text={view.responseText} />
          </div>
        </Section>
      )}
      {view.toolCalls.length > 0 && (
        <Section title="请求的工具调用">
          <div className="flex flex-wrap gap-1.5">
            {view.toolCalls.map((call, index) => (
              <Badge key={call.id ?? index} variant="outline" className={call.invalidArgsError ? 'border-amber-500/40 text-amber-700 dark:text-amber-400' : undefined}>
                {call.toolName}
                {call.invalidArgsError ? '（参数错误）' : ''}
              </Badge>
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}

function ToolCallOverview({ view }: { view: ToolCallEvidenceView }) {
  const stats = [
    { label: '工具', value: view.toolName ?? '未知' },
    { label: '耗时', value: formatOptionalDuration(view.durationMs ?? durationOf(view)) },
    { label: '退出码', value: view.exitCode != null ? String(view.exitCode) : '—' },
  ]
  return (
    <div className="space-y-3">
      <StatGrid items={stats} />
      <div className="flex flex-wrap gap-1.5">
        {view.serverName && <Badge variant="outline">{view.serverName}</Badge>}
        {view.operationType && <Badge variant="outline">{view.operationType}</Badge>}
        {view.scope && <Badge variant="outline">{view.scope}</Badge>}
      </div>
      {view.errorText && <ErrorBlock text={view.errorText} />}
      {view.pending && <p className="text-xs text-amber-600">工具调用缺少结束记录</p>}
      {view.outputText && (
        <Section title="输出">
          <div className="rounded-lg bg-muted/60 p-3">
            <ExpandableText text={view.outputText} />
          </div>
        </Section>
      )}
    </div>
  )
}

function PolicyDecisionOverview({ view }: { view: PolicyDecisionView }) {
  return (
    <div className="space-y-3">
      <DecisionBanner view={view} />
      {view.reason && <p className="text-xs/relaxed text-muted-foreground">{view.reason}</p>}
      {view.whitelistMatchKey && (
        <p className="text-xs text-muted-foreground">
          命中记忆授权：
          <code className="rounded-sm bg-muted px-1 py-0.5 break-all">{view.whitelistMatchKey}</code>
        </p>
      )}
      <KeyValueList items={[
        ...(permissionContextLabel(view) ? [{ label: '权限模式', value: permissionContextLabel(view)! }] : []),
        ...(view.initialBasis && view.initialBasis !== view.basis && policyBasisLabel(view.initialBasis)
          ? [{ label: '基础判定', value: policyBasisLabel(view.initialBasis)! }]
          : []),
        ...(policyBasisLabel(view.basis)
          ? [{ label: view.initialBasis && view.initialBasis !== view.basis ? '最终依据' : '判定依据', value: policyBasisLabel(view.basis)! }]
          : []),
        { label: '目标工具', value: view.toolName ?? '未知' },
        { label: '操作类型', value: view.operationType ?? '—' },
        { label: '作用范围', value: view.scope ?? '—' },
      ]}
      />
    </div>
  )
}

function DecisionBanner({ view }: { view: PolicyDecisionView }) {
  const status = view.status
  const config = status === 'allow'
    ? { icon: ShieldCheckIcon, label: view.whitelistMatchKey ? '允许执行（命中记忆授权）' : '允许执行', className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' }
    : status === 'block'
      ? { icon: ShieldXIcon, label: '已阻止', className: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400' }
      : view.outcome === 'allow'
        ? { icon: ShieldCheckIcon, label: '审批后放行', className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' }
        : view.outcome === 'block'
          ? { icon: ShieldXIcon, label: '审批已拒绝', className: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400' }
          : { icon: ShieldAlertIcon, label: '需要审批', className: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400' }
  const Icon = config.icon
  return (
    <div className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium ${config.className}`}>
      <Icon className="size-4" />
      {config.label}
    </div>
  )
}

/** Automation Turn 展示自动化权限策略；交互 Turn 展示用户选择的权限模式。 */
function permissionContextLabel(view: PolicyDecisionView): string | undefined {
  if (view.automationPolicy || view.basis?.startsWith('automation.'))
    return 'Automation 权限策略'
  return agentModeLabel(view.mode)
}

function ContextEventOverview({ view }: { view: ContextEventView }) {
  if (view.eventKind === 'steering') {
    return (
      <Section title="追加的指令">
        <blockquote className="rounded-lg border-l-2 border-primary/50 bg-muted/60 p-3 text-xs/relaxed break-all whitespace-pre-wrap">
          {view.text ?? '（无内容）'}
        </blockquote>
      </Section>
    )
  }
  if (view.eventKind === 'compaction') {
    return (
      <div className="space-y-3">
        <StatGrid items={[
          { label: '触发方式', value: view.trigger === 'automatic' ? '自动' : (view.trigger ?? '—') },
          { label: '压缩前条目', value: view.inputMessageCount != null ? String(view.inputMessageCount) : '—' },
          { label: '压缩后消息数', value: view.outputMessageCount != null ? String(view.outputMessageCount) : '—' },
        ]}
        />
        {view.summaryText && (
          <Section title="压缩摘要">
            <div className="rounded-lg bg-muted/60 p-3">
              <ExpandableText text={view.summaryText} />
            </div>
          </Section>
        )}
      </div>
    )
  }
  return (
    <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
      该事件类型暂不支持概览，请切换到「原始证据」查看完整记录。
    </div>
  )
}

function durationOf(view: { startedAt?: number, endedAt?: number }): number | undefined {
  return view.startedAt != null && view.endedAt != null ? Math.max(0, view.endedAt - view.startedAt) : undefined
}

function formatOptionalDuration(ms: number | undefined): string {
  return ms != null ? formatDuration(ms) : '—'
}

function formatOptionalNumber(value: number | undefined): string {
  return value != null ? value.toLocaleString() : '—'
}
