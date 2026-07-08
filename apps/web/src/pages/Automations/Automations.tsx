import type { AutomationDefinition, AutomationInput, AutomationRun, UpdateAutomationInput } from '@ant-chat/shared'
import type { AutomationContextOptions, AutomationItem } from './automation-types'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@workspace/ui/components/alert-dialog'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@workspace/ui/components/dropdown-menu'
import { Switch } from '@workspace/ui/components/switch'
import { CalendarClock, CheckCircle2, Clock3, History, MoreHorizontal, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { automationApi } from '@/api/automationApi'
import { getMcpServers } from '@/api/mcpApi'
import { providerApi } from '@/api/providerApi'
import { skillApi } from '@/api/skillApi'
import workspaceApi from '@/api/workspaceApi'
import { AUTOMATION_CHANGED_EVENT, AUTOMATION_RUN_CHANGED_EVENT } from '@/constants/automationEvents'
import { activateWorkspace } from '@/store/conversation'
import { setActiveConversationsId } from '@/store/messages'
import { useWorkspaceStore } from '@/store/workspace'
import { OverviewCard, RunHistorySheet, TaskMeta } from './automation-components'
import { toAutomationItem } from './automation-utils'
import { CreateAutomationSheet } from './CreateAutomationSheet'

export function AutomationsPage() {
  const navigate = useNavigate()
  const [automations, setAutomations] = useState<AutomationItem[]>([])
  const [definitions, setDefinitions] = useState<AutomationDefinition[]>([])
  const [contextOptions, setContextOptions] = useState<AutomationContextOptions>({ workspaces: [], modelGroups: [], skills: [], mcpServers: [] })
  const [runs, setRuns] = useState<AutomationRun[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [editingTarget, setEditingTarget] = useState<AutomationDefinition>()
  const [runningId, setRunningId] = useState<string>()
  const [historyTarget, setHistoryTarget] = useState<'all' | string>()
  const [deleteTarget, setDeleteTarget] = useState<AutomationItem>()
  const [menuOpenId, setMenuOpenId] = useState<string>()

  const refreshPage = useCallback(async () => {
    const [definitions, workspaceResult, modelGroups, skillIndex, mcpServers] = await Promise.all([
      automationApi.list(),
      workspaceApi.listWorkspaces(),
      providerApi.getAllAbvailableModels(),
      skillApi.listSkills(),
      getMcpServers(),
    ])
    setContextOptions({ workspaces: workspaceResult.workspaces, modelGroups, skills: skillIndex.skills.filter(skill => skill.enabled), mcpServers })
    setDefinitions(definitions)
    setAutomations(definitions.map(definition => toAutomationItem(definition, modelGroups)))
  }, [])

  useEffect(() => {
    void refreshPage()
    const handleChanged = () => void refreshPage()
    window.addEventListener(AUTOMATION_CHANGED_EVENT, handleChanged)
    window.addEventListener(AUTOMATION_RUN_CHANGED_EVENT, handleChanged)
    return () => {
      window.removeEventListener(AUTOMATION_CHANGED_EVENT, handleChanged)
      window.removeEventListener(AUTOMATION_RUN_CHANGED_EVENT, handleChanged)
    }
  }, [refreshPage])

  useEffect(() => {
    if (!historyTarget) {
      return
    }
    const refreshRuns = () => {
      void automationApi.listRuns(historyTarget === 'all' ? undefined : historyTarget).then(setRuns)
    }
    window.addEventListener(AUTOMATION_RUN_CHANGED_EVENT, refreshRuns)
    return () => window.removeEventListener(AUTOMATION_RUN_CHANGED_EVENT, refreshRuns)
  }, [historyTarget])

  async function setEnabled(id: string, enabled: boolean) {
    const definition = await automationApi.setEnabled(id, enabled)
    setDefinitions(items => items.map(item => item.id === id ? definition : item))
    setAutomations(items => items.map(item => item.id === id ? toAutomationItem(definition, contextOptions.modelGroups) : item))
  }

  async function runNow(id: string) {
    setRunningId(id)
    try {
      const run = await automationApi.runNow(id)
      const automation = automations.find(item => item.id === id)
      await openConversation(run, automation)
    }
    catch (error) {
      toast.error(error instanceof Error ? error.message : '任务启动失败')
    }
    finally {
      setRunningId(undefined)
    }
  }

  async function openConversation(run: AutomationRun, automation?: AutomationItem) {
    if (!run.conversationId || !automation)
      throw new Error(run.errorMessage || '该运行记录没有可查看的会话')
    await useWorkspaceStore.getState().openWorkspace(automation.workspacePath)
    await activateWorkspace(automation.workspacePath)
    await setActiveConversationsId(run.conversationId)
    navigate('/chat')
  }

  async function openRunConversation(run: AutomationRun) {
    try {
      await openConversation(run, automations.find(item => item.id === run.automationId))
    }
    catch (error) {
      toast.error(error instanceof Error ? error.message : '会话打开失败')
    }
  }

  async function createAutomation(input: AutomationInput) {
    const definition = await automationApi.create(input)
    setDefinitions(items => [definition, ...items])
    setAutomations(items => [toAutomationItem(definition, contextOptions.modelGroups), ...items])
    setCreateOpen(false)
  }

  async function updateAutomation(input: UpdateAutomationInput) {
    const definition = await automationApi.update(input)
    setDefinitions(items => items.map(item => item.id === definition.id ? definition : item))
    setAutomations(items => items.map(item => item.id === definition.id ? toAutomationItem(definition, contextOptions.modelGroups) : item))
    toast.success('自动化已更新')
    setEditingTarget(undefined)
  }

  async function openHistory(target: 'all' | string) {
    setHistoryTarget(target)
    setRuns(await automationApi.listRuns(target === 'all' ? undefined : target))
  }

  async function deleteAutomation() {
    if (!deleteTarget)
      return
    await automationApi.delete(deleteTarget.id)
    setDefinitions(items => items.filter(item => item.id !== deleteTarget.id))
    setAutomations(items => items.filter(item => item.id !== deleteTarget.id))
    toast.success('自动化已删除')
    setDeleteTarget(undefined)
  }

  const enabledCount = automations.filter(item => item.enabled).length
  const nextAutomation = automations.find(item => item.enabled)

  return (
    <main className="h-full overflow-y-auto bg-background">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-5 py-8 md:px-10 md:py-12">
        <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div className="flex max-w-2xl flex-col gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold tracking-[0.16em] text-muted-foreground uppercase">
              <Sparkles aria-hidden="true" />
              自动化
            </div>
            <h1 className="font-heading text-2xl leading-tight font-semibold tracking-tight md:text-3xl">
              让重复工作按时发生
            </h1>
            <p className="text-sm leading-6 text-muted-foreground md:text-base">
              安排一次性或周期任务。每次执行都会创建独立会话，结果清楚可追溯。
            </p>
          </div>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus data-icon="inline-start size-4" />
            新建自动化
          </Button>
        </header>

        <section className="grid gap-3 md:grid-cols-3" aria-label="自动化概览">
          <OverviewCard icon={<CalendarClock />} label="已启用" value={`${enabledCount} 个`} detail="正在等待调度" />
          <OverviewCard icon={<Clock3 />} label="下一次执行" value={nextAutomation?.nextRun ?? '暂无计划'} detail={nextAutomation?.name ?? '创建任务后显示'} />
          <OverviewCard icon={<CheckCircle2 />} label="运行记录" value={`${runs.filter(run => run.status === 'succeeded').length} 次成功`} detail="打开记录后同步最新结果" />
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
            <Button variant="ghost" size="sm" onClick={() => void openHistory('all')}>
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
                    <DropdownMenu open={menuOpenId === item.id} onOpenChange={open => setMenuOpenId(open ? item.id : undefined)}>
                      <DropdownMenuTrigger render={(
                        <Button variant="ghost" size="icon-sm" aria-label={`更多${item.name}操作`} onClick={() => setMenuOpenId(item.id)}>
                          <MoreHorizontal />
                        </Button>
                      )}
                      />
                      <DropdownMenuContent align="end">
                        <DropdownMenuGroup>
                          <DropdownMenuItem onClick={() => {
                            const def = definitions.find(d => d.id === item.id)
                            if (def) {
                              setEditingTarget(def)
                            }
                          }}
                          >
                            <Pencil className="size-3.5" />
                            编辑任务
                          </DropdownMenuItem>
                          <DropdownMenuItem variant="destructive" onClick={() => setDeleteTarget(item)}>
                            <Trash2 className="size-3.5" />
                            删除任务
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
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
                  <Button variant="ghost" size="sm" onClick={() => void openHistory(item.id)}>运行记录</Button>
                  <Button variant="outline" size="sm" disabled={runningId === item.id} onClick={() => void runNow(item.id)}>
                    {runningId === item.id ? '运行中…' : '立即运行'}
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        </section>
      </div>

      <CreateAutomationSheet
        open={createOpen || Boolean(editingTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setCreateOpen(false)
            setEditingTarget(undefined)
          }
        }}
        onCreate={createAutomation}
        onUpdate={updateAutomation}
        editingDefinition={editingTarget}
        contextOptions={contextOptions}
      />
      <RunHistorySheet
        target={historyTarget}
        automations={automations}
        records={runs}
        onOpenChange={open => !open && setHistoryTarget(undefined)}
        onOpenConversation={openRunConversation}
      />
      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={open => !open && setDeleteTarget(undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              删除“
              {deleteTarget?.name}
              ”？
            </AlertDialogTitle>
            <AlertDialogDescription>自动化及其运行记录会被永久删除，此操作无法撤销。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void deleteAutomation()}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  )
}
