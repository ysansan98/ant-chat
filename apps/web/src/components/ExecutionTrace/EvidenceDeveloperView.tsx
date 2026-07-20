import type { ContextEventView, EvidenceView, ModelRequestView, PolicyDecisionView, ToolCallEvidenceView, UsageView } from './evidenceModel'
import { Badge } from '@workspace/ui/components/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@workspace/ui/components/collapsible'
import { ChevronRightIcon } from 'lucide-react'
import { useState } from 'react'
import { formatDuration } from '@/utils'
import { agentModeLabel, policyBasisLabel } from './evidenceModel'
import { CodeBlock, ErrorBlock, KeyValueList, Section, StatGrid } from './evidencePrimitives'
import { JsonTree } from './JsonTree'

/** 详情 Tab：关键指标 + 完整输入输出，结构化渲染。 */
export function EvidenceDetailView({ view }: { view: EvidenceView }) {
  if (view.type === 'model-request')
    return <ModelRequestDetail view={view} />
  if (view.type === 'tool-call')
    return <ToolCallDetail view={view} />
  if (view.type === 'policy-decision')
    return <PolicyDecisionDetail view={view} />
  if (view.type === 'context-event')
    return <ContextEventDetail view={view} />
  return (
    <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
      {view.reason}
      ，请切换到「原始证据」查看完整记录。
    </div>
  )
}

function ModelRequestDetail({ view }: { view: ModelRequestView }) {
  const stats = [
    { label: '模型', value: view.model ?? '未知' },
    { label: '耗时', value: formatOptionalDuration(view.responseDurationMs ?? durationOf(view)) },
    { label: '结束原因', value: view.finishReason ?? '—' },
    { label: '请求工具数', value: String(view.toolCalls.length) },
  ]
  return (
    <div className="space-y-4">
      <StatGrid items={stats} />
      {view.errorText && <ErrorBlock text={view.errorText} />}
      {view.pending && !view.errorText && <p className="text-xs text-amber-600">模型请求缺少结束记录</p>}
      {(view.responseText != null || view.toolCalls.length > 0 || view.usage) && (
        <Section title="响应">
          <div className="space-y-3">
            {view.responseText && (
              <SubSection title="回复文本">
                <CodeBlock text={view.responseText} />
              </SubSection>
            )}
            {view.toolCalls.length > 0 && (
              <SubSection title={`工具调用（${view.toolCalls.length}）`}>
                <div className="space-y-1.5">
                  {view.toolCalls.map((call, index) => (
                    <div key={call.id ?? index} className="rounded-lg border border-border p-2.5">
                      <div className="flex flex-wrap items-center gap-1.5 text-xs">
                        <span className="font-medium">{call.toolName}</span>
                        {call.invalidArgsError && <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-400">参数错误</Badge>}
                      </div>
                      {call.invalidArgsError && <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{call.invalidArgsError}</p>}
                      {call.input != null && <JsonTree className="mt-1.5" value={call.input} expandDepth={2} />}
                    </div>
                  ))}
                </div>
              </SubSection>
            )}
            {view.usage && <UsageList usage={view.usage} />}
            <KeyValueList items={[
              ...(view.responseDurationMs != null ? [{ label: '响应耗时', value: `${view.responseDurationMs} ms` }] : []),
            ]}
            />
          </div>
        </Section>
      )}
      {view.errorRaw != null && (
        <Section title="错误">
          <div className="space-y-2">
            {view.errorText && <ErrorBlock text={view.errorText} />}
            <JsonTree value={view.errorRaw} expandDepth={2} />
          </div>
        </Section>
      )}
    </div>
  )
}

function ToolCallDetail({ view }: { view: ToolCallEvidenceView }) {
  const stats = [
    { label: '工具', value: view.toolName ?? '未知' },
    { label: '耗时', value: formatOptionalDuration(view.durationMs ?? durationOf(view)) },
    { label: '退出码', value: view.exitCode != null ? String(view.exitCode) : '—' },
  ]
  return (
    <div className="space-y-4">
      <StatGrid items={stats} />
      <div className="flex flex-wrap gap-1.5">
        {view.serverName && <Badge variant="outline">{view.serverName}</Badge>}
        {view.operationType && <Badge variant="outline">{view.operationType}</Badge>}
        {view.scope && <Badge variant="outline">{view.scope}</Badge>}
      </div>
      {view.errorText && <ErrorBlock text={view.errorText} />}
      {view.pending && <p className="text-xs text-amber-600">工具调用缺少结束记录</p>}
      <Section title="输入 · 工具调用准备">
        <div className="space-y-3">
          <KeyValueList items={[
            ...(view.serverName ? [{ label: '服务', value: view.serverName }] : []),
            ...(view.operationType ? [{ label: '操作类型', value: view.operationType }] : []),
            ...(view.scope ? [{ label: '作用范围', value: view.scope }] : []),
            ...(view.workspacePath ? [{ label: '工作目录', value: <code className="break-all">{view.workspacePath}</code> }] : []),
            ...(view.step != null ? [{ label: '步骤序号', value: String(view.step) }] : []),
            ...(view.toolCallId ? [{ label: 'toolCallId', value: <code className="break-all">{view.toolCallId}</code> }] : []),
          ]}
          />
          <SubSection title="调用参数">
            {view.input != null ? <JsonTree value={view.input} expandDepth={2} /> : <EmptyHint>无参数</EmptyHint>}
          </SubSection>
        </div>
      </Section>
      {(view.outputText != null || view.diagnostics != null || view.exitCode != null) && (
        <Section title="输出 · 工具执行结果">
          <div className="space-y-3">
            {view.outputText != null && <CodeBlock text={view.outputText} maxHeight="max-h-96" />}
            <KeyValueList items={[
              ...(view.exitCode != null ? [{ label: '退出码', value: String(view.exitCode) }] : []),
              ...(view.durationMs != null ? [{ label: '执行耗时', value: `${view.durationMs} ms` }] : []),
            ]}
            />
            {view.diagnostics != null && (
              <SubSection title="诊断信息">
                <JsonTree value={view.diagnostics} expandDepth={2} />
              </SubSection>
            )}
          </div>
        </Section>
      )}
    </div>
  )
}

function PolicyDecisionDetail({ view }: { view: PolicyDecisionView }) {
  const basisText = policyBasisLabel(view.basis)
  const modeText = permissionContextLabel(view) ?? agentModeLabel(view.mode)
  const toolTags = [
    view.toolName,
    view.operationType,
    view.scope,
  ].filter(Boolean)

  return (
    <div className="space-y-4">
      {toolTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {toolTags.map((tag, i) => (
            <Badge key={`${tag}-${i}`} variant="outline">{tag}</Badge>
          ))}
        </div>
      )}

      {modeText && (
        <div className="rounded-lg bg-muted/60 px-3 py-2.5">
          <span className="text-[11px] text-muted-foreground">当前权限</span>
          <p className="text-sm font-medium">{modeText}</p>
        </div>
      )}
      {basisText && (
        <div className="rounded-lg bg-muted/60 px-3 py-2.5">
          <span className="text-[11px] text-muted-foreground">
            {view.status === 'allow' || view.outcome === 'allow' ? '为什么允许' : '为什么阻止'}
          </span>
          <p className="text-sm font-medium">{basisText}</p>
        </div>
      )}

      <Section title="判断详情">
        <div className="space-y-3">
          <KeyValueList items={[
            ...(view.approvalApproved != null ? [{ label: '审批', value: view.approvalApproved ? '用户批准' : '用户拒绝' }] : []),
            ...(view.approvalReason ? [{ label: '审批说明', value: view.approvalReason }] : []),
            ...(view.reason ? [{ label: '原因', value: view.reason }] : []),
            ...(view.errorCode ? [{ label: '错误码', value: view.errorCode }] : []),
            ...(view.whitelistMatchKey ? [{ label: '白名单匹配键', value: <code className="break-all">{view.whitelistMatchKey}</code> }] : []),
          ]}
          />
          {view.whitelistEntry != null && (
            <SubSection title="命中的白名单条目">
              <JsonTree value={view.whitelistEntry} expandDepth={2} />
            </SubSection>
          )}
        </div>
      </Section>

      {view.input != null && (
        <CollapsibleSection title="工具参数">
          <JsonTree value={view.input} expandDepth={2} />
        </CollapsibleSection>
      )}

      {(view.workspacePath || view.step != null || view.toolCallId || view.automationPolicy) && (
        <CollapsibleSection title="更多上下文">
          <div className="space-y-2">
            <KeyValueList items={[
              ...(view.workspacePath ? [{ label: '工作目录', value: <code className="break-all">{view.workspacePath}</code> }] : []),
              ...(view.step != null ? [{ label: '步骤序号', value: String(view.step) }] : []),
              ...(view.toolCallId ? [{ label: 'toolCallId', value: <code className="break-all">{view.toolCallId}</code> }] : []),
            ]}
            />
            {view.automationPolicy && <JsonTree value={view.automationPolicy} expandDepth={2} />}
          </div>
        </CollapsibleSection>
      )}

      {view.errorRaw != null && (
        <Section title="错误">
          <JsonTree value={view.errorRaw} expandDepth={2} />
        </Section>
      )}
    </div>
  )
}

function ContextEventDetail({ view }: { view: ContextEventView }) {
  return (
    <Section title="事件证据">
      {view.raw != null
        ? <JsonTree value={view.raw} expandDepth={2} />
        : <EmptyHint>事件证据不可用</EmptyHint>}
    </Section>
  )
}

// ============================================================
// 共享渲染组件
// ============================================================

function CollapsibleSection({ title, children }: { title: string, children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border border-border">
      <CollapsibleTrigger render={(
        <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs">
          <ChevronRightIcon className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`} />
          <span className="font-medium">{title}</span>
        </button>
      )}
      />
      <CollapsibleContent>
        <div className="border-t border-border px-3 py-2.5">
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function permissionContextLabel(view: PolicyDecisionView): string | undefined {
  if (view.automationPolicy || view.basis?.startsWith('automation.'))
    return 'Automation 权限策略'
  return agentModeLabel(view.mode)
}

function durationOf(view: { startedAt?: number, endedAt?: number }): number | undefined {
  return view.startedAt != null && view.endedAt != null ? Math.max(0, view.endedAt - view.startedAt) : undefined
}

function formatOptionalDuration(ms: number | undefined): string {
  return ms != null ? formatDuration(ms) : '—'
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>
}

function UsageList({ usage }: { usage: UsageView }) {
  return (
    <KeyValueList items={[
      ...(usage.inputTokens != null ? [{ label: '输入 Tokens', value: String(usage.inputTokens) }] : []),
      ...(usage.outputTokens != null ? [{ label: '输出 Tokens', value: String(usage.outputTokens) }] : []),
      ...(usage.totalTokens != null ? [{ label: '总 Tokens', value: String(usage.totalTokens) }] : []),
      ...(usage.reasoningTokens != null ? [{ label: '推理 Tokens', value: String(usage.reasoningTokens) }] : []),
      ...(usage.cachedInputTokens != null ? [{ label: '缓存 Tokens', value: String(usage.cachedInputTokens) }] : []),
    ]}
    />
  )
}

function SubSection({ title, children }: { title: string, children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h5 className="text-xs font-medium text-muted-foreground">{title}</h5>
      {children}
    </div>
  )
}
