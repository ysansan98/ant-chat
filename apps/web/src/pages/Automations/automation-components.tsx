import type { AutomationRun } from '@ant-chat/shared'
import type { ReactNode } from 'react'
import type { AutomationItem } from './automation-types'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@workspace/ui/components/sheet'
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
                  <p className="text-sm leading-6">{record.summary || record.errorMessage || '任务正在执行，完成后会显示结果。'}</p>
                </CardContent>
                <CardFooter className="justify-between">
                  <span className="text-xs text-muted-foreground">独立会话</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!record.conversationId}
                    onClick={() => void props.onOpenConversation(record)}
                  >
                    查看会话
                  </Button>
                </CardFooter>
              </Card>
            )
          })}
        </div>
      </SheetContent>
    </Sheet>
  )
}
