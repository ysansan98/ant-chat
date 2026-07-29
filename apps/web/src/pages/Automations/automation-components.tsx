import type { AutomationRun } from '@ant-chat/shared'
import type { ReactNode } from 'react'
import type { AutomationItem } from './automation-types'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@workspace/ui/components/collapsible'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@workspace/ui/components/sheet'
import { Switch } from '@workspace/ui/components/switch'
import { Check, ChevronDown } from 'lucide-react'
import { formatDuration, formatRunStatus, formatTimestamp } from './automation-utils'

export function OverviewCard(props: { icon: ReactNode, label: string, value: string, detail: string }) {
  return (
    <Card size="sm">
      <CardContent className="flex items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          {props.icon}
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{props.label}</p>
          <p className="font-heading font-semibold">{props.value}</p>
          <p className="truncate text-xs text-muted-foreground">{props.detail}</p>
        </div>
      </CardContent>
    </Card>
  )
}

export function TaskMeta(props: { label: string, value: string, code?: string, status?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs text-muted-foreground">{props.label}</span>
      <div className="flex min-w-0 items-center gap-2">
        {props.status && <Badge variant="secondary">{props.status}</Badge>}
        <span className="truncate text-sm font-medium">{props.value}</span>
      </div>
      {props.code && <code className="font-mono text-xs text-muted-foreground">{props.code}</code>}
    </div>
  )
}

export function RunHistorySheet(props: {
  target?: 'all' | string
  automations: AutomationItem[]
  records: AutomationRun[]
  onOpenChange: (open: boolean) => void
  onOpenConversation: (record: AutomationRun) => Promise<void>
  onInspectTrace: (record: AutomationRun) => Promise<void>
}) {
  const selectedAutomation = props.target === 'all'
    ? undefined
    : props.automations.find(item => item.id === props.target)
  const records = props.records

  return (
    <Sheet open={Boolean(props.target)} onOpenChange={props.onOpenChange}>
      <SheetContent className="w-full overflow-y-auto px-3">
        <SheetHeader>
          <SheetTitle className="text-xl">
            {selectedAutomation ? `${selectedAutomation.name} · 运行记录` : '全部运行记录'}
          </SheetTitle>
          <SheetDescription>
            {selectedAutomation
              ? '查看该自动化每次执行的结果、耗时和对应会话。'
              : '按时间查看所有自动化任务的执行流水。'}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-3">
          {records.length === 0 && (
            <EmptyState
              title="还没有运行记录"
              description="任务首次执行后，结果和对应会话会出现在这里。"
            />
          )}
          {records.map((record) => {
            const automation = props.automations.find(item => item.id === record.automationId)
            return (
              <Card key={record.id} size="sm">
                <CardHeader>
                  <div className="min-w-0">
                    {props.target === 'all' && <CardTitle className="truncate">{automation?.name}</CardTitle>}
                    <CardDescription>
                      {record.startedAt ? formatTimestamp(record.startedAt) : '等待执行'}
                      {' '}
                      ·
                      {' '}
                      {formatDuration(record)}
                    </CardDescription>
                  </div>
                  <CardAction>
                    <Badge variant={record.status === 'succeeded' ? 'secondary' : 'destructive'}>{formatRunStatus(record.status)}</Badge>
                  </CardAction>
                </CardHeader>
                <CardContent>
                  <p className="text-sm/6">{record.summary || record.errorMessage || '任务正在执行，完成后会显示结果。'}</p>
                </CardContent>
                <CardFooter className="justify-between gap-2">
                  <span className="text-xs text-muted-foreground">独立会话</span>
                  <span className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!record.turnId || !record.conversationId}
                      onClick={() => void props.onInspectTrace(record)}
                    >
                      检查 Trace
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!record.conversationId}
                      onClick={() => void props.onOpenConversation(record)}
                    >
                      查看会话
                    </Button>
                  </span>
                </CardFooter>
              </Card>
            )
          })}
        </div>
      </SheetContent>
    </Sheet>
  )
}

/** 2 列切换按钮网格 —— CapabilityPicker 内部使用 */
export function MultiChoiceGrid(props: {
  options: Array<{ value: string, label: string, description: string }>
  selected: string[]
  onToggle: (value: string) => void
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {props.options.map((option) => {
        const selected = props.selected.includes(option.value)
        return (
          <Button
            key={option.value}
            type="button"
            variant={selected ? 'secondary' : 'outline'}
            className="h-auto justify-between rounded-xl px-3 py-2 text-left"
            aria-pressed={selected}
            onClick={() => props.onToggle(option.value)}
          >
            <span className="min-w-0">
              <span className="block truncate font-medium">{option.label}</span>
              <span className="block truncate text-xs font-normal text-muted-foreground">{option.description}</span>
            </span>
            {selected && <Check data-icon="inline-end" />}
          </Button>
        )
      })}
    </div>
  )
}

/** 带描述的权限开关 */
export function PermissionSwitch(props: {
  label: string
  description?: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 text-sm">
      <span className="min-w-0">
        <span className="block font-medium">{props.label}</span>
        {props.description && <span className="block text-xs text-muted-foreground">{props.description}</span>}
      </span>
      <Switch checked={props.checked} onCheckedChange={props.onCheckedChange} />
    </label>
  )
}

/** 可折叠的能力选择器 —— 用于 Skill / MCP 多选 */
export function CapabilityPicker(props: {
  icon: ReactNode
  title: string
  description: string
  options: Array<{ value: string, label: string, description: string }>
  selected: string[]
  onToggle: (value: string) => void
  orphaned?: Array<{ value: string, label: string }>
  onRemoveOrphaned?: (value: string) => void
}) {
  const hasOrphaned = (props.orphaned?.length ?? 0) > 0
  return (
    <Collapsible className="group rounded-xl border border-border/70">
      <CollapsibleTrigger render={(
        <Button type="button" variant="ghost" className="h-auto w-full justify-start rounded-xl px-4 py-3 text-left">
          <span className="flex min-w-0 flex-1 items-center gap-3">
            {props.icon}
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="font-semibold">{props.title}</span>
                {props.selected.length > 0 && (
                  <Badge variant="secondary">
                    {props.selected.length}
                    {' '}
                    个已选
                  </Badge>
                )}
                {hasOrphaned && (
                  <Badge variant="destructive">
                    {props.orphaned!.length}
                    {' '}
                    个不可用
                  </Badge>
                )}
              </span>
              <span className="block truncate text-xs font-normal text-muted-foreground">{props.description}</span>
            </span>
            <ChevronDown className="transition-transform group-data-open:rotate-180" />
          </span>
        </Button>
      )}
      />
      <CollapsibleContent>
        <div className="border-t border-border/70 p-3">
          {props.options.length > 0
            ? <MultiChoiceGrid options={props.options} selected={props.selected} onToggle={props.onToggle} />
            : <EmptyState title="暂无可用项" />}
          {hasOrphaned && (
            <div className="mt-3 border-t border-border/50 pt-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground">不可用（skill 已删除或禁用）</p>
              <div className="flex flex-wrap gap-2">
                {props.orphaned!.map(item => (
                  <Badge key={item.value} variant="outline" className="flex items-center gap-1 border-destructive/40 text-destructive">
                    {item.label}
                    <button
                      type="button"
                      className="ml-1 inline-flex size-3.5 items-center justify-center rounded-full hover:bg-destructive/10"
                      aria-label={`移除 ${item.label}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        props.onRemoveOrphaned?.(item.value)
                      }}
                    >
                      ×
                    </button>
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
