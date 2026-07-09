import type { AutomationDefinition, AutomationInput, UpdateAutomationInput } from '@ant-chat/shared'
import type { FormEvent } from 'react'
import type { AutomationContextOptions } from './automation-types'
import { Alert, AlertDescription, AlertTitle } from '@workspace/ui/components/alert'
import { Button } from '@workspace/ui/components/button'
import { Input } from '@workspace/ui/components/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/components/select'
import { Separator } from '@workspace/ui/components/separator'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@workspace/ui/components/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@workspace/ui/components/tabs'
import { Textarea } from '@workspace/ui/components/textarea'
import { CalendarClock, ChevronDown, FileKey2, FolderCode, ServerCog, ShieldCheck, Sparkles } from 'lucide-react'
import { ModelSelect } from '@/components/Common/ModelSelect'
import { CapabilityPicker, PermissionSwitch } from './automation-components'
import { describeNextRun, formatDateTime, weekdays } from './automation-utils'
import { useAutomationForm } from './useAutomationForm'

export function CreateAutomationSheet(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (input: AutomationInput) => Promise<void>
  onUpdate?: (input: UpdateAutomationInput) => Promise<void>
  editingDefinition?: AutomationDefinition
  contextOptions: AutomationContextOptions
}) {
  const {
    form,
    updateForm,
    isEditing,
    cron,
    effectiveWorkspace,
    effectiveModel,
    modelDisplayName,
    orphanedSkills,
    toggleWeekday,
    toggleInArray,
    buildInput,
  } = useAutomationForm({
    editingDefinition: props.editingDefinition,
    contextOptions: props.contextOptions,
  })

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!form.name.trim() || !form.prompt.trim())
      return

    const input = buildInput()

    if (isEditing && props.onUpdate) {
      await props.onUpdate({ id: props.editingDefinition!.id, ...input })
    }
    else {
      await props.onCreate(input)
    }

    if (isEditing) {
      props.onOpenChange(false)
    }
    else {
      updateForm((draft) => {
        draft.name = ''
        draft.prompt = ''
      })
    }
  }

  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent className="w-full overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-160">
        <SheetHeader>
          <SheetTitle className="text-xl">{isEditing ? '编辑自动化' : '新建自动化'}</SheetTitle>
          <SheetDescription>{isEditing ? '修改任务配置、执行计划或权限。' : '描述任务，并决定它什么时候运行。'}</SheetDescription>
        </SheetHeader>

        <form id="create-automation" className="flex flex-1 flex-col gap-6 px-3" onSubmit={handleSubmit}>
          <fieldset className="flex flex-col gap-4">
            <legend className="mb-3 text-sm font-semibold">任务</legend>
            <label className="flex flex-col gap-2 text-sm font-medium">
              名称
              <Input
                value={form.name}
                placeholder="例如：每日项目进展整理"
                required
                onChange={event => updateForm((draft) => { draft.name = event.target.value })}
              />
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium">
              要执行的任务
              <Textarea
                value={form.prompt}
                placeholder="清楚描述目标、范围和期望输出…"
                required
                onChange={event => updateForm((draft) => { draft.prompt = event.target.value })}
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
                      updateForm((draft) => {
                        draft.workspace = value
                      })
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
                    updateForm((draft) => {
                      draft.modelValue = { modelId: next.modelId, providerId: next.providerId }
                    })
                  }}
                  options={props.contextOptions.modelGroups}
                  className="flex h-9 w-full cursor-default items-center justify-between rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm outline-hidden hover:bg-accent"
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
              options={props.contextOptions.skills.filter(s => s.enabled).map(skill => ({ value: skill.name, label: skill.name, description: skill.description || 'Agent Skill' }))}
              selected={form.selectedSkills}
              onToggle={value => updateForm((draft) => { toggleInArray(draft.selectedSkills, value) })}
              orphaned={orphanedSkills}
              onRemoveOrphaned={(value) => {
                updateForm((draft) => {
                  draft.selectedSkills = draft.selectedSkills.filter(s => s !== value)
                })
              }}
            />

            <CapabilityPicker
              icon={<ServerCog aria-hidden="true" />}
              title="MCP 服务"
              description="可多选，仅连接当前任务需要的服务。"
              options={props.contextOptions.mcpServers.map(connection => ({ value: connection.name, label: connection.name, description: `${connection.tools?.length ?? 0} 个工具` }))}
              selected={form.selectedMcps}
              onToggle={value => updateForm((draft) => { toggleInArray(draft.selectedMcps, value) })}
            />
          </fieldset>

          <Separator />

          <fieldset className="flex flex-col gap-4">
            <legend className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <CalendarClock aria-hidden="true" />
              计划
            </legend>
            <Tabs value={form.mode} onValueChange={value => updateForm((draft) => { draft.mode = value as typeof form.mode })}>
              <TabsList className="grid h-9 w-full grid-cols-2 p-0">
                <TabsTrigger value="once">仅一次</TabsTrigger>
                <TabsTrigger value="cron">周期执行</TabsTrigger>
              </TabsList>

              <TabsContent value="cron" className="flex flex-col gap-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="flex flex-col gap-2 text-sm font-medium">
                    重复
                    <Select
                      items={{ daily: '每天', weekly: '每周', monthly: '每月', custom: '自定义 cron' }}
                      value={form.repeatKind}
                      onValueChange={(value) => {
                        if (value) {
                          updateForm((draft) => {
                            draft.repeatKind = value as typeof form.repeatKind
                          })
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
                  {form.repeatKind !== 'custom' && (
                    <label className="flex flex-col gap-2 text-sm font-medium">
                      执行时间
                      <Input aria-label="周期执行时间" type="time" value={form.time} onChange={event => updateForm((draft) => { draft.time = event.target.value })} />
                    </label>
                  )}
                </div>

                {form.repeatKind === 'weekly' && (
                  <div className="flex flex-col gap-2">
                    <span className="text-sm font-medium">执行日期</span>
                    <div className="grid grid-cols-7 gap-2">
                      {weekdays.map(day => (
                        <Button
                          key={day.value}
                          type="button"
                          variant={form.selectedWeekdays.includes(day.value) ? 'secondary' : 'outline'}
                          size="icon"
                          aria-label={`周${day.label}`}
                          aria-pressed={form.selectedWeekdays.includes(day.value)}
                          onClick={() => toggleWeekday(day.value)}
                        >
                          {day.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                {form.repeatKind === 'monthly' && (
                  <label className="flex flex-col gap-2 text-sm font-medium">
                    每月日期
                    <Select
                      items={Array.from({ length: 28 }, (_, index) => {
                        const value = String(index + 1)
                        return { label: `${value} 日`, value }
                      })}
                      value={form.monthDay}
                      onValueChange={(value) => {
                        if (value) {
                          updateForm((draft) => {
                            draft.monthDay = value
                          })
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

                {form.repeatKind === 'custom' && (
                  <label className="flex flex-col gap-2 text-sm font-medium">
                    Cron 表达式
                    <Input
                      className="font-mono"
                      value={form.customCron}
                      onChange={event => updateForm((draft) => { draft.customCron = event.target.value })}
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
                  <Input aria-label="一次性执行时间" type="datetime-local" value={form.onceAt} onChange={event => updateForm((draft) => { draft.onceAt = event.target.value })} />
                </label>
              </TabsContent>
            </Tabs>

            <div className="rounded-xl border border-border/70 bg-muted/40 p-4">
              <p className="text-xs font-medium text-muted-foreground">下一次执行</p>
              <p className="mt-1 font-heading text-lg font-semibold">
                {form.mode === 'cron'
                  ? describeNextRun(form.repeatKind, form.time, form.selectedWeekdays, form.monthDay)
                  : formatDateTime(form.onceAt)}
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
                  value={form.permissionScopes.workspaceWrite ? 'write' : 'read'}
                  onValueChange={(value) => {
                    if (value) {
                      updateForm((draft) => {
                        draft.permissionScopes.workspaceWrite = value === 'write'
                      })
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
                label="运行所选 Skills"
                description={`允许 ${form.selectedSkills.length} 个已选 Skill 在自身安装目录内读、写、执行`}
                checked={form.permissionScopes.selectedSkillRuntime}
                onCheckedChange={checked => updateForm((draft) => { draft.permissionScopes.selectedSkillRuntime = checked })}
              />
              <PermissionSwitch
                label="允许 MCP 执行有副作用的操作"
                description={`未开启时，${form.selectedMcps.length} 个已选服务仅可调用只读工具`}
                checked={form.permissionScopes.mcpMutations}
                onCheckedChange={checked => updateForm((draft) => { draft.permissionScopes.mcpMutations = checked })}
              />
              <Separator />
              <div className="flex items-start gap-3">
                <FileKey2 aria-hidden="true" />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div>
                    <p className="text-sm font-semibold">额外文件范围</p>
                    <p className="text-xs text-muted-foreground">工作区外的路径必须单独声明。</p>
                  </div>
                  <Input value={form.extraFileRoots} placeholder="例如：~/Documents/reports, /tmp/exports" aria-label="额外文件范围" onChange={event => updateForm((draft) => { draft.extraFileRoots = event.target.value })} />
                </div>
              </div>
              <Separator />
              <PermissionSwitch
                label="允许终端命令"
                description="关闭时，Agent 无法执行 bash 等终端命令"
                checked={form.permissionScopes.bashCommands}
                onCheckedChange={checked => updateForm((draft) => { draft.permissionScopes.bashCommands = checked })}
              />
              {form.permissionScopes.bashCommands && (
                <label className="ml-4 flex flex-col gap-2 border-l border-border pl-4 text-sm font-medium">
                  允许的命令模式
                  <Input value={form.bashCommandPatterns} placeholder="ls *, cat **, git status" aria-label="允许的命令模式" onChange={event => updateForm((draft) => { draft.bashCommandPatterns = event.target.value })} />
                </label>
              )}
            </div>
          </fieldset>
        </form>

        <SheetFooter>
          <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)}>取消</Button>
          <Button type="submit" form="create-automation">{isEditing ? '保存修改' : '创建自动化'}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
