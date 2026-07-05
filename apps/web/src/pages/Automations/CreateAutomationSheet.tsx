import type { AutomationInput } from '@ant-chat/shared'
import type { FormEvent, ReactNode } from 'react'
import type { AutomationContextOptions, RepeatKind, ScheduleMode } from './automation-types'
import type { ModelSelectValue } from '@/components/Common/ModelSelect'
import { Alert, AlertDescription, AlertTitle } from '@workspace/ui/components/alert'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@workspace/ui/components/collapsible'
import { Input } from '@workspace/ui/components/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/components/select'
import { Separator } from '@workspace/ui/components/separator'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@workspace/ui/components/sheet'
import { Switch } from '@workspace/ui/components/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@workspace/ui/components/tabs'
import { Textarea } from '@workspace/ui/components/textarea'
import { CalendarClock, Check, ChevronDown, FileKey2, FolderCode, ServerCog, ShieldCheck, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { ModelSelect } from '@/components/Common/ModelSelect'
import { buildCron, describeNextRun, formatDateTime, splitCommaList, weekdays } from './automation-utils'

const segmentedTabClassName = [
  'rounded-md px-3 text-[14px] font-medium text-muted-foreground shadow-none',
  'data-active:bg-accent data-active:text-accent-foreground data-active:shadow-none',
].join(' ')

export function CreateAutomationSheet(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (input: AutomationInput) => Promise<void>
  contextOptions: AutomationContextOptions
}) {
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [workspace, setWorkspace] = useState('')
  const [modelValue, setModelValue] = useState<ModelSelectValue>({ modelId: '', providerId: '' })
  const [mode, setMode] = useState<ScheduleMode>('cron')
  const [repeatKind, setRepeatKind] = useState<RepeatKind>('weekly')
  const [time, setTime] = useState('09:00')
  const [onceAt, setOnceAt] = useState('2026-07-08T16:00')
  const [selectedWeekdays, setSelectedWeekdays] = useState(['1', '3', '5'])
  const [monthDay, setMonthDay] = useState('1')
  const [customCron, setCustomCron] = useState('0 9 * * 1-5')
  const [selectedSkills, setSelectedSkills] = useState<string[]>([])
  const [selectedMcps, setSelectedMcps] = useState<string[]>([])
  const [permissionScopes, setPermissionScopes] = useState({
    workspaceWrite: true,
    skillScripts: true,
    mcpMutations: false,
    arbitraryCommands: false,
    network: false,
  })
  const [extraFileRoots, setExtraFileRoots] = useState('')
  const [commandPatterns, setCommandPatterns] = useState('')

  const cron = buildCron(repeatKind, time, selectedWeekdays, monthDay, customCron)

  const firstModel = useMemo(
    () => props.contextOptions.modelGroups.flatMap(
      group => group.models.map(model => ({ providerId: group.id, model })),
    )[0],
    [props.contextOptions.modelGroups],
  )
  const effectiveWorkspace = workspace || props.contextOptions.workspaces[0]?.path || ''
  const effectiveModel: ModelSelectValue = useMemo(
    () => modelValue.modelId
      ? modelValue
      : (firstModel ? { modelId: firstModel.model.id, providerId: firstModel.providerId } : { modelId: '', providerId: '' }),
    [modelValue, firstModel],
  )

  const modelDisplayName = useMemo(() => {
    if (!effectiveModel.modelId)
      return '选择模型'
    const p = props.contextOptions.modelGroups.find(g => g.id === effectiveModel.providerId)
    const m = p?.models.find(mod => mod.id === effectiveModel.modelId)
    return m ? `${p!.name} · ${m.name}` : '选择模型'
  }, [effectiveModel, props.contextOptions.modelGroups])

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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!name.trim() || !prompt.trim())
      return

    const { modelId, providerId } = effectiveModel
    await props.onCreate({
      name: name.trim(),
      prompt: prompt.trim(),
      workspacePath: effectiveWorkspace,
      providerId,
      modelId,
      selectedSkills,
      selectedMcpServers: selectedMcps,
      permissionPolicy: {
        workspaceAccess: permissionScopes.workspaceWrite ? 'write' : 'read',
        allowSkillScripts: permissionScopes.skillScripts,
        allowMcpMutations: permissionScopes.mcpMutations,
        extraFileRoots: splitCommaList(extraFileRoots),
        allowArbitraryCommands: permissionScopes.arbitraryCommands,
        commandPatterns: splitCommaList(commandPatterns),
        allowNetwork: permissionScopes.network,
      },
      schedule: mode === 'cron'
        ? { type: 'cron', expression: cron, timezone: 'Asia/Shanghai' }
        : { type: 'once', runAt: new Date(onceAt).getTime() },
      enabled: true,
    })
    setName('')
    setPrompt('')
  }

  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent className="w-full overflow-y-auto  data-[side=right]:w-full data-[side=right]:sm:max-w-160 px-3">
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
                <Select
                  items={props.contextOptions.workspaces.map(item => ({ label: item.displayName, value: item.path }))}
                  value={effectiveWorkspace}
                  onValueChange={(value) => {
                    if (value) {
                      setWorkspace(value)
                    }
                  }}
                >
                  <SelectTrigger className="w-full" aria-label="工作区">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {props.contextOptions.workspaces.map(item => <SelectItem key={item.path} value={item.path}>{item.displayName}</SelectItem>)}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </label>
              <label className="flex flex-col gap-2 text-sm font-medium">
                模型
                <ModelSelect
                  value={effectiveModel}
                  onChange={(next) => {
                    setModelValue({ modelId: next.modelId, providerId: next.providerId })
                  }}
                  options={props.contextOptions.modelGroups}
                  className="flex h-9 w-full cursor-default items-center justify-between rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm hover:bg-accent outline-hidden"
                >
                  <span className="truncate">{modelDisplayName}</span>
                  <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                </ModelSelect>
              </label>
            </div>

            <CapabilityPicker
              icon={<Sparkles aria-hidden="true" />}
              title="Skills"
              description="可多选，Agent 会按任务需要组合使用。"
              options={props.contextOptions.skills.map(skill => ({ value: skill.name, label: skill.name, description: skill.description || 'Agent Skill' }))}
              selected={selectedSkills}
              onToggle={value => toggleSelection(value, selectedSkills, setSelectedSkills)}
            />

            <CapabilityPicker
              icon={<ServerCog aria-hidden="true" />}
              title="MCP 服务"
              description="可多选，仅连接当前任务需要的服务。"
              options={props.contextOptions.mcpServers.map(connection => ({ value: connection.name, label: connection.name, description: `${connection.tools?.length ?? 0} 个工具` }))}
              selected={selectedMcps}
              onToggle={value => toggleSelection(value, selectedMcps, setSelectedMcps)}
            />
          </fieldset>

          <Separator />

          <fieldset className="flex flex-col gap-4">
            <legend className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <CalendarClock aria-hidden="true" />
              计划
            </legend>
            <Tabs value={mode} onValueChange={value => setMode(value as ScheduleMode)}>
              <TabsList className="grid h-9 w-full grid-cols-2 bg-transparent p-0">
                <TabsTrigger className={segmentedTabClassName} value="once">仅一次</TabsTrigger>
                <TabsTrigger className={segmentedTabClassName} value="cron">周期执行</TabsTrigger>
              </TabsList>

              <TabsContent value="cron" className="flex flex-col gap-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="flex flex-col gap-2 text-sm font-medium">
                    重复
                    <Select
                      items={{ daily: '每天', weekly: '每周', monthly: '每月', custom: '自定义 cron' }}
                      value={repeatKind}
                      onValueChange={(value) => {
                        if (value) {
                          setRepeatKind(value as RepeatKind)
                        }
                      }}
                    >
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
                    <Select
                      items={Array.from({ length: 28 }, (_, index) => {
                        const value = String(index + 1)
                        return { label: `${value} 日`, value }
                      })}
                      value={monthDay}
                      onValueChange={(value) => {
                        if (value) {
                          setMonthDay(value)
                        }
                      }}
                    >
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
              </TabsContent>
              <TabsContent value="once">
                <label className="flex flex-col gap-2 text-sm font-medium">
                  执行时间
                  <Input aria-label="一次性执行时间" type="datetime-local" value={onceAt} onChange={event => setOnceAt(event.target.value)} />
                </label>
              </TabsContent>
            </Tabs>

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
                  <p className="truncate text-xs text-muted-foreground">{effectiveWorkspace || '请先选择工作区'}</p>
                </div>
                <Select
                  items={{ read: '只读', write: '读写' }}
                  value={permissionScopes.workspaceWrite ? 'write' : 'read'}
                  onValueChange={(value) => {
                    if (value) {
                      setPermissionScopes(current => ({ ...current, workspaceWrite: value === 'write' }))
                    }
                  }}
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
                  <Input value={extraFileRoots} placeholder="例如：~/Documents/reports, /tmp/exports" aria-label="额外文件范围" onChange={event => setExtraFileRoots(event.target.value)} />
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
                  <Input value={commandPatterns} placeholder="git status, git diff, pnpm test" aria-label="允许的命令模式" onChange={event => setCommandPatterns(event.target.value)} />
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

function CapabilityPicker(props: {
  icon: ReactNode
  title: string
  description: string
  options: Array<{ value: string, label: string, description: string }>
  selected: string[]
  onToggle: (value: string) => void
}) {
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
            : <p className="py-3 text-center text-sm text-muted-foreground">暂无可用项</p>}
        </div>
      </CollapsibleContent>
    </Collapsible>
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
