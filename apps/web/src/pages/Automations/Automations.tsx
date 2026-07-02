import { Alert, AlertDescription, AlertTitle } from '@workspace/ui/components/alert'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@workspace/ui/components/card'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { Input } from '@workspace/ui/components/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@workspace/ui/components/select'
import { Separator } from '@workspace/ui/components/separator'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@workspace/ui/components/sheet'
import { Switch } from '@workspace/ui/components/switch'
import { Textarea } from '@workspace/ui/components/textarea'
import {
  CalendarClock,
  Check,
  CheckCircle2,
  Clock3,
  FileKey2,
  FolderCode,
  History,
  MoreHorizontal,
  Plus,
  ServerCog,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { useState } from 'react'

type ScheduleMode = 'once' | 'cron'
type RepeatKind = 'daily' | 'weekly' | 'monthly' | 'custom'

const weekdays = [
  { value: '1', label: '一' },
  { value: '2', label: '二' },
  { value: '3', label: '三' },
  { value: '4', label: '四' },
  { value: '5', label: '五' },
  { value: '6', label: '六' },
  { value: '0', label: '日' },
]

interface AutomationItem {
  id: string
  name: string
  prompt: string
  workspace: string
  model: string
  schedule: string
  scheduleDetail: string
  nextRun: string
  lastRun: string
  enabled: boolean
  status: 'success' | 'waiting'
}

const initialAutomations: AutomationItem[] = [
  {
    id: 'daily-summary',
    name: '每日项目进展整理',
    prompt: '读取工作区最近一天的改动，整理风险、待办和建议。',
    workspace: 'ant-chat',
    model: 'GPT-5 Codex',
    schedule: '0 9 * * 1-5',
    scheduleDetail: '工作日 09:00',
    nextRun: '明天 09:00',
    lastRun: '今天 09:02 · 用时 1分18秒',
    enabled: true,
    status: 'success',
  },
  {
    id: 'dependency-audit',
    name: '每周依赖风险检查',
    prompt: '检查依赖更新、安全公告和可能的破坏性变更。',
    workspace: 'ant-chat',
    model: 'Claude Sonnet',
    schedule: '0 10 * * 1',
    scheduleDetail: '每周一 10:00',
    nextRun: '7月6日 10:00',
    lastRun: '6月29日 10:05 · 用时 3分42秒',
    enabled: true,
    status: 'success',
  },
  {
    id: 'release-notes',
    name: '生成 1.0 发布说明',
    prompt: '根据提交记录和 changeset 生成 1.0 版本发布说明。',
    workspace: 'ant-chat',
    model: 'GPT-5 Codex',
    schedule: '2026-07-08 16:00',
    scheduleDetail: '仅一次 · 7月8日 16:00',
    nextRun: '7月8日 16:00',
    lastRun: '尚未运行',
    enabled: false,
    status: 'waiting',
  },
]

export function AutomationsPage() {
  const [automations, setAutomations] = useState(initialAutomations)
  const [createOpen, setCreateOpen] = useState(false)
  const [runningId, setRunningId] = useState<string>()
  const [historyTarget, setHistoryTarget] = useState<'all' | string>()

  function setEnabled(id: string, enabled: boolean) {
    setAutomations(items => items.map(item => item.id === id ? { ...item, enabled } : item))
  }

  function runNow(id: string) {
    setRunningId(id)
    window.setTimeout(() => {
      setAutomations(items => items.map(item => item.id === id
        ? { ...item, lastRun: '刚刚 · 用时 12秒', status: 'success' }
        : item))
      setRunningId(undefined)
    }, 900)
  }

  function createAutomation(input: Omit<AutomationItem, 'id' | 'lastRun' | 'status'>) {
    setAutomations(items => [{
      ...input,
      id: `automation-${items.length + 1}`,
      lastRun: '尚未运行',
      status: 'waiting',
    }, ...items])
    setCreateOpen(false)
  }

  const enabledCount = automations.filter(item => item.enabled).length

  return (
    <main className="h-full overflow-y-auto bg-background">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-5 py-8 md:px-10 md:py-12">
        <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div className="flex max-w-2xl flex-col gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold tracking-[0.16em] text-muted-foreground uppercase">
              <Sparkles aria-hidden="true" />
              自动化
            </div>
            <h1 className="font-heading text-3xl leading-tight font-semibold tracking-tight md:text-4xl">
              让重复工作按时发生
            </h1>
            <p className="text-sm leading-6 text-muted-foreground md:text-base">
              安排一次性或周期任务。每次执行都会创建独立会话，结果清楚可追溯。
            </p>
          </div>
          <Button size="lg" onClick={() => setCreateOpen(true)}>
            <Plus data-icon="inline-start" />
            新建自动化
          </Button>
        </header>

        <section className="grid gap-3 md:grid-cols-3" aria-label="自动化概览">
          <OverviewCard icon={<CalendarClock />} label="已启用" value={`${enabledCount} 个`} detail="正在等待调度" />
          <OverviewCard icon={<Clock3 />} label="下一次执行" value="明天 09:00" detail="每日项目进展整理" />
          <OverviewCard icon={<CheckCircle2 />} label="近 7 天" value="12 次成功" detail="无失败任务" />
        </section>

        <section className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-heading text-lg font-semibold">任务</h2>
              <p className="text-sm text-muted-foreground">
                {automations.length}
                {' '}
                个自动化任务
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setHistoryTarget('all')}>
              <History data-icon="inline-start" />
              全部运行记录
            </Button>
          </div>

          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,22rem),1fr))] gap-3">
            {automations.map(item => (
              <Card key={item.id} size="sm" className="transition-shadow hover:shadow-md">
                <CardHeader>
                  <div className="min-w-0">
                    <CardTitle className="truncate">{item.name}</CardTitle>
                    <CardDescription className="mt-1 line-clamp-2 min-h-10 leading-5">{item.prompt}</CardDescription>
                  </div>
                  <CardAction className="flex items-center gap-2">
                    <Switch
                      checked={item.enabled}
                      aria-label={`${item.enabled ? '停用' : '启用'}${item.name}`}
                      onCheckedChange={enabled => setEnabled(item.id, enabled)}
                    />
                    <Button variant="ghost" size="icon-sm" aria-label={`更多${item.name}操作`}>
                      <MoreHorizontal />
                    </Button>
                  </CardAction>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">{item.workspace}</Badge>
                    <Badge variant="outline">{item.model}</Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-3 rounded-lg bg-muted/50 p-3">
                    <TaskMeta label="计划" value={item.scheduleDetail} />
                    <TaskMeta label="下次执行" value={item.enabled ? item.nextRun : '已停用'} />
                  </div>
                </CardContent>
                <CardFooter className="justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setHistoryTarget(item.id)}>运行记录</Button>
                  <Button variant="outline" size="sm" disabled={runningId === item.id} onClick={() => runNow(item.id)}>
                    {runningId === item.id ? '运行中…' : '立即运行'}
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        </section>
      </div>

      <CreateAutomationSheet
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreate={createAutomation}
      />
      <RunHistorySheet
        target={historyTarget}
        automations={automations}
        onOpenChange={open => !open && setHistoryTarget(undefined)}
      />
    </main>
  )
}

function OverviewCard(props: { icon: React.ReactNode, label: string, value: string, detail: string }) {
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

function TaskMeta(props: { label: string, value: string, code?: string, status?: string }) {
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

const runHistory = [
  { id: 'run-1', automationId: 'daily-summary', startedAt: '今天 09:00', duration: '1分18秒', status: '成功', summary: '已生成项目进展整理，共发现 2 个风险和 4 个待办。' },
  { id: 'run-2', automationId: 'dependency-audit', startedAt: '6月29日 10:00', duration: '3分42秒', status: '成功', summary: '检查了 46 个依赖，发现 3 个可升级项。' },
  { id: 'run-3', automationId: 'daily-summary', startedAt: '昨天 09:00', duration: '54秒', status: '需要处理', summary: '访问工作区外文件时暂停，等待补充授权。' },
  { id: 'run-4', automationId: 'daily-summary', startedAt: '6月30日 09:00', duration: '1分05秒', status: '成功', summary: '已生成项目进展整理，共发现 1 个风险和 3 个待办。' },
]

function RunHistorySheet(props: {
  target?: 'all' | string
  automations: AutomationItem[]
  onOpenChange: (open: boolean) => void
}) {
  const selectedAutomation = props.target === 'all'
    ? undefined
    : props.automations.find(item => item.id === props.target)
  const records = props.target === 'all'
    ? runHistory
    : runHistory.filter(record => record.automationId === props.target)

  return (
    <Sheet open={Boolean(props.target)} onOpenChange={props.onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:w-[34rem] sm:max-w-[34rem]">
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
                      {record.startedAt}
                      {' '}
                      ·
                      {' '}
                      {record.duration}
                    </CardDescription>
                  </div>
                  <CardAction>
                    <Badge variant={record.status === '成功' ? 'secondary' : 'destructive'}>{record.status}</Badge>
                  </CardAction>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-6">{record.summary}</p>
                </CardContent>
                <CardFooter className="justify-between">
                  <span className="text-xs text-muted-foreground">独立会话</span>
                  <Button variant="ghost" size="sm">查看会话</Button>
                </CardFooter>
              </Card>
            )
          })}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function CreateAutomationSheet(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (input: Omit<AutomationItem, 'id' | 'lastRun' | 'status'>) => void
}) {
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [workspace, setWorkspace] = useState('ant-chat')
  const [model, setModel] = useState('GPT-5 Codex')
  const [mode, setMode] = useState<ScheduleMode>('cron')
  const [repeatKind, setRepeatKind] = useState<RepeatKind>('weekly')
  const [time, setTime] = useState('09:00')
  const [onceAt, setOnceAt] = useState('2026-07-08T16:00')
  const [selectedWeekdays, setSelectedWeekdays] = useState(['1', '3', '5'])
  const [monthDay, setMonthDay] = useState('1')
  const [customCron, setCustomCron] = useState('0 9 * * 1-5')
  const [selectedSkills, setSelectedSkills] = useState(['improve', 'review'])
  const [selectedMcps, setSelectedMcps] = useState(['filesystem', 'git'])
  const [permissionScopes, setPermissionScopes] = useState({
    workspaceWrite: true,
    skillScripts: true,
    mcpMutations: false,
    arbitraryCommands: false,
    network: false,
  })

  const cron = buildCron(repeatKind, time, selectedWeekdays, monthDay, customCron)

  function toggleWeekday(day: string) {
    setSelectedWeekdays((selected) => {
      if (selected.includes(day))
        return selected.length === 1 ? selected : selected.filter(value => value !== day)
      return [...selected, day]
    })
  }

  function toggleSelection(value: string, selected: string[], onChange: (next: string[]) => void) {
    onChange(selected.includes(value) ? selected.filter(item => item !== value) : [...selected, value])
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!name.trim() || !prompt.trim())
      return

    props.onCreate({
      name: name.trim(),
      prompt: prompt.trim(),
      workspace,
      model,
      schedule: mode === 'cron' ? cron : onceAt.replace('T', ' '),
      scheduleDetail: mode === 'cron'
        ? describeSchedule(repeatKind, time, selectedWeekdays, monthDay)
        : `仅一次 · ${formatDateTime(onceAt)}`,
      nextRun: mode === 'cron'
        ? describeNextRun(repeatKind, time, selectedWeekdays, monthDay)
        : formatDateTime(onceAt),
      enabled: true,
    })
    setName('')
    setPrompt('')
  }

  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:w-[38rem] sm:max-w-[38rem]">
        <SheetHeader>
          <SheetTitle className="text-xl">新建自动化</SheetTitle>
          <SheetDescription>描述任务，并决定它什么时候运行。</SheetDescription>
        </SheetHeader>

        <form id="create-automation" className="flex flex-1 flex-col gap-6" onSubmit={submit}>
          <fieldset className="flex flex-col gap-4">
            <legend className="mb-3 text-sm font-semibold">任务</legend>
            <label className="flex flex-col gap-2 text-sm font-medium">
              名称
              <Input
                value={name}
                placeholder="例如：每日项目进展整理"
                required
                onChange={event => setName(event.target.value)}
              />
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium">
              要执行的任务
              <Textarea
                value={prompt}
                placeholder="清楚描述目标、范围和期望输出…"
                required
                onChange={event => setPrompt(event.target.value)}
              />
            </label>
          </fieldset>

          <Separator />

          <fieldset className="flex flex-col gap-4">
            <legend className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <FolderCode aria-hidden="true" />
              执行上下文
            </legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-2 text-sm font-medium">
                工作区
                <Select value={workspace} onValueChange={setWorkspace}>
                  <SelectTrigger className="w-full" aria-label="工作区">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="ant-chat">ant-chat</SelectItem>
                      <SelectItem value="personal-site">personal-site</SelectItem>
                      <SelectItem value="无工作区">无工作区</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </label>
              <label className="flex flex-col gap-2 text-sm font-medium">
                模型
                <Select value={model} onValueChange={setModel}>
                  <SelectTrigger className="w-full" aria-label="模型">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="GPT-5 Codex">GPT-5 Codex</SelectItem>
                      <SelectItem value="Claude Sonnet">Claude Sonnet</SelectItem>
                      <SelectItem value="DeepSeek V3">DeepSeek V3</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </label>
            </div>

            <div className="rounded-xl border border-border/70 p-4">
              <div className="mb-3 flex items-start gap-3">
                <Sparkles aria-hidden="true" />
                <div>
                  <p className="text-sm font-semibold">Skills</p>
                  <p className="text-xs text-muted-foreground">可多选，Agent 会按任务需要组合使用。</p>
                </div>
              </div>
              <MultiChoiceGrid
                options={[
                  { value: 'improve', label: 'improve', description: '代码库改进建议' },
                  { value: 'review', label: 'review-and-refactor', description: '代码审查与重构' },
                  { value: 'deep-investigate', label: 'deep-investigate', description: '深度调研' },
                ]}
                selected={selectedSkills}
                onToggle={value => toggleSelection(value, selectedSkills, setSelectedSkills)}
              />
            </div>

            <div className="rounded-xl border border-border/70 p-4">
              <div className="mb-3 flex items-start gap-3">
                <ServerCog aria-hidden="true" />
                <div>
                  <p className="text-sm font-semibold">MCP 服务</p>
                  <p className="text-xs text-muted-foreground">可多选，仅连接当前任务需要的服务。</p>
                </div>
              </div>
              <MultiChoiceGrid
                options={[
                  { value: 'filesystem', label: '文件系统', description: '读写授权目录' },
                  { value: 'git', label: 'Git', description: '仓库与提交信息' },
                  { value: 'github', label: 'GitHub', description: 'Issue 与 Pull Request' },
                ]}
                selected={selectedMcps}
                onToggle={value => toggleSelection(value, selectedMcps, setSelectedMcps)}
              />
            </div>
          </fieldset>

          <Separator />

          <fieldset className="flex flex-col gap-4">
            <legend className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <CalendarClock aria-hidden="true" />
              计划
            </legend>
            <div className="grid grid-cols-2 rounded-xl bg-muted p-1">
              <Button type="button" variant={mode === 'once' ? 'secondary' : 'ghost'} onClick={() => setMode('once')}>
                仅一次
              </Button>
              <Button type="button" variant={mode === 'cron' ? 'secondary' : 'ghost'} onClick={() => setMode('cron')}>
                周期执行
              </Button>
            </div>

            {mode === 'cron'
              ? (
                  <>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="flex flex-col gap-2 text-sm font-medium">
                        重复
                        <Select value={repeatKind} onValueChange={value => setRepeatKind(value as RepeatKind)}>
                          <SelectTrigger className="w-full" aria-label="重复频率">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectItem value="daily">每天</SelectItem>
                              <SelectItem value="weekly">每周</SelectItem>
                              <SelectItem value="monthly">每月</SelectItem>
                              <SelectItem value="custom">自定义 cron</SelectItem>
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </label>
                      {repeatKind !== 'custom' && (
                        <label className="flex flex-col gap-2 text-sm font-medium">
                          执行时间
                          <Input aria-label="周期执行时间" type="time" value={time} onChange={event => setTime(event.target.value)} />
                        </label>
                      )}
                    </div>

                    {repeatKind === 'weekly' && (
                      <div className="flex flex-col gap-2">
                        <span className="text-sm font-medium">执行日期</span>
                        <div className="grid grid-cols-7 gap-2">
                          {weekdays.map(day => (
                            <Button
                              key={day.value}
                              type="button"
                              variant={selectedWeekdays.includes(day.value) ? 'secondary' : 'outline'}
                              size="icon"
                              aria-label={`周${day.label}`}
                              aria-pressed={selectedWeekdays.includes(day.value)}
                              onClick={() => toggleWeekday(day.value)}
                            >
                              {day.label}
                            </Button>
                          ))}
                        </div>
                      </div>
                    )}

                    {repeatKind === 'monthly' && (
                      <label className="flex flex-col gap-2 text-sm font-medium">
                        每月日期
                        <Select value={monthDay} onValueChange={setMonthDay}>
                          <SelectTrigger className="w-full" aria-label="每月日期">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              {Array.from({ length: 28 }, (_, index) => String(index + 1)).map(day => (
                                <SelectItem key={day} value={day}>
                                  {day}
                                  {' '}
                                  日
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </label>
                    )}

                    {repeatKind === 'custom' && (
                      <label className="flex flex-col gap-2 text-sm font-medium">
                        Cron 表达式
                        <Input
                          className="font-mono"
                          value={customCron}
                          onChange={event => setCustomCron(event.target.value)}
                        />
                      </label>
                    )}

                    <div className="flex items-center justify-between rounded-xl bg-muted/60 px-4 py-3">
                      <span className="text-xs text-muted-foreground">生成的 cron</span>
                      <code className="font-mono text-sm font-semibold">{cron}</code>
                    </div>
                  </>
                )
              : (
                  <label className="flex flex-col gap-2 text-sm font-medium">
                    执行时间
                    <Input aria-label="一次性执行时间" type="datetime-local" value={onceAt} onChange={event => setOnceAt(event.target.value)} />
                  </label>
                )}

            <div className="rounded-xl border border-border/70 bg-muted/40 p-4">
              <p className="text-xs font-medium text-muted-foreground">下一次执行</p>
              <p className="mt-1 font-heading text-lg font-semibold">
                {mode === 'cron'
                  ? describeNextRun(repeatKind, time, selectedWeekdays, monthDay)
                  : formatDateTime(onceAt)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">Asia/Shanghai · 应用离线时将在恢复后补执行一次</p>
            </div>
          </fieldset>

          <Separator />

          <fieldset className="flex flex-col gap-4">
            <legend className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck aria-hidden="true" />
              运行权限
            </legend>
            <Alert>
              <ShieldCheck />
              <AlertTitle>只授权明确的能力范围</AlertTitle>
              <AlertDescription>未覆盖的文件、命令或 MCP 操作会暂停任务并通知你，不会在后台静默扩大权限。</AlertDescription>
            </Alert>
            <div className="flex flex-col gap-4 rounded-xl border border-border/70 p-4">
              <div className="flex items-start gap-3">
                <FolderCode aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">工作区</p>
                  <p className="truncate text-xs text-muted-foreground">/Users/ysansan/webProject/ant-chat</p>
                </div>
                <Select
                  value={permissionScopes.workspaceWrite ? 'write' : 'read'}
                  onValueChange={value => setPermissionScopes(current => ({ ...current, workspaceWrite: value === 'write' }))}
                >
                  <SelectTrigger size="sm" aria-label="工作区权限">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="read">只读</SelectItem>
                      <SelectItem value="write">读写</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
              <Separator />
              <PermissionSwitch
                label="允许所选 Skill 执行自带脚本"
                description={`仅限 ${selectedSkills.length} 个已选 Skill 安装目录内的脚本`}
                checked={permissionScopes.skillScripts}
                onCheckedChange={checked => setPermissionScopes(value => ({ ...value, skillScripts: checked }))}
              />
              <PermissionSwitch
                label="允许 MCP 执行有副作用的操作"
                description={`未开启时，${selectedMcps.length} 个已选服务仅可调用只读工具`}
                checked={permissionScopes.mcpMutations}
                onCheckedChange={checked => setPermissionScopes(value => ({ ...value, mcpMutations: checked }))}
              />
              <Separator />
              <div className="flex items-start gap-3">
                <FileKey2 aria-hidden="true" />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div>
                    <p className="text-sm font-semibold">额外文件范围</p>
                    <p className="text-xs text-muted-foreground">工作区外的路径必须单独声明。</p>
                  </div>
                  <Input placeholder="例如：~/Documents/reports, /tmp/exports" aria-label="额外文件范围" />
                </div>
              </div>
              <Separator />
              <PermissionSwitch
                label="允许任意终端命令"
                description="关闭时，仅允许所选 Skill 的自带脚本"
                checked={permissionScopes.arbitraryCommands}
                onCheckedChange={checked => setPermissionScopes(value => ({ ...value, arbitraryCommands: checked }))}
              />
              {permissionScopes.arbitraryCommands && (
                <label className="ml-4 flex flex-col gap-2 border-l border-border pl-4 text-sm font-medium">
                  允许的命令模式
                  <Input defaultValue="git status, git diff, pnpm test" aria-label="允许的命令模式" />
                </label>
              )}
              <PermissionSwitch
                label="允许直接访问网络"
                description="MCP 自身的连接不受此项影响；仅控制脚本和终端命令"
                checked={permissionScopes.network}
                onCheckedChange={checked => setPermissionScopes(value => ({ ...value, network: checked }))}
              />
            </div>
          </fieldset>
        </form>

        <SheetFooter>
          <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)}>取消</Button>
          <Button type="submit" form="create-automation">创建自动化</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function MultiChoiceGrid(props: {
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

function PermissionSwitch(props: {
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

function buildCron(kind: RepeatKind, time: string, selectedDays: string[], monthDay: string, customCron: string) {
  if (kind === 'custom')
    return customCron

  const [hour = '0', minute = '0'] = time.split(':')
  if (kind === 'daily')
    return `${minute} ${hour} * * *`
  if (kind === 'monthly')
    return `${minute} ${hour} ${monthDay} * *`
  const orderedDays = weekdays.filter(day => selectedDays.includes(day.value)).map(day => day.value)
  return `${minute} ${hour} * * ${orderedDays.join(',')}`
}

function describeSchedule(kind: RepeatKind, time: string, selectedDays: string[], monthDay: string) {
  if (kind === 'daily')
    return `每天 ${time}`
  if (kind === 'monthly')
    return `每月 ${monthDay} 日 ${time}`
  if (kind === 'custom')
    return '自定义计划'
  return `每周${formatWeekdays(selectedDays)} ${time}`
}

function describeNextRun(kind: RepeatKind, time: string, selectedDays: string[], monthDay: string) {
  if (kind === 'daily')
    return `明天 ${time}`
  if (kind === 'monthly')
    return `下个 ${monthDay} 日 ${time}`
  if (kind === 'custom')
    return '按 cron 表达式计算'
  return `下一个周${formatWeekdays(selectedDays)} ${time}`
}

function formatWeekdays(selectedDays: string[]) {
  return weekdays.filter(day => selectedDays.includes(day.value)).map(day => day.label).join('、')
}

function formatDateTime(value: string) {
  const [date = '', time = ''] = value.split('T')
  return `${date} ${time}`.trim()
}
