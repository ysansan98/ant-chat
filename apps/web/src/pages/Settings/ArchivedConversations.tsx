import type { ArchivedConversationWorkspace, IConversations } from '@ant-chat/shared'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@workspace/ui/components/alert-dialog'
import { Button } from '@workspace/ui/components/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@workspace/ui/components/dropdown-menu'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@workspace/ui/components/input-group'
import { ScrollArea } from '@workspace/ui/components/scroll-area'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/components/select'
import { Spinner } from '@workspace/ui/components/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { ArchiveIcon, EllipsisIcon, FolderIcon, RotateCcwIcon, SearchIcon, Trash2Icon } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import chatApi from '@/api/chatApi'
import { getAppEventSubscriptions } from '@/api/transports/appEventSubscriptions'
import { clearConversationPendingMessages } from '@/store/pendingMessages'
import { formatTime } from '@/utils'
import { SettingsPageLayout } from './SettingsPageLayout'

const PAGE_SIZE = 20
const ALL_WORKSPACES_FILTER = 'all'
const UNASSIGNED_WORKSPACE_KEY = 'unassigned'

interface ConversationPageState {
  data: IConversations[]
  total: number
  nextPage: number
  loading: boolean
  error: string
}

type DeleteTarget
  = | { type: 'conversation', id: string, title: string, count: 1 }
    | { type: 'workspace', workspacePath: string | null, title: string, count: number }
    | { type: 'all', count: number }

export function ArchivedConversations() {
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [workspaces, setWorkspaces] = useState<ArchivedConversationWorkspace[]>([])
  const [workspaceOptions, setWorkspaceOptions] = useState<ArchivedConversationWorkspace[]>([])
  const [workspaceFilter, setWorkspaceFilter] = useState(ALL_WORKSPACES_FILTER)
  const [totalArchived, setTotalArchived] = useState(0)
  const [pages, setPages] = useState<Record<string, ConversationPageState>>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const [deleting, setDeleting] = useState(false)
  const requestVersionRef = useRef(0)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [query])

  const loadWorkspaces = useCallback(async () => {
    const version = ++requestVersionRef.current
    setLoading(true)
    setLoadError('')
    try {
      const result = await chatApi.getArchivedConversationWorkspaces(debouncedQuery, PAGE_SIZE)
      if (version !== requestVersionRef.current) {
        return
      }
      setWorkspaces(result.workspaces)
      if (!debouncedQuery) {
        setWorkspaceOptions(result.workspaces)
        setWorkspaceFilter(current => current === ALL_WORKSPACES_FILTER || result.workspaces.some(workspace => getWorkspaceKey(workspace.workspacePath) === current) ? current : ALL_WORKSPACES_FILTER)
      }
      setTotalArchived(result.total)
      setPages(Object.fromEntries(result.workspaces.map(workspace => [getWorkspaceKey(workspace.workspacePath), {
        data: workspace.conversations,
        total: workspace.matchedTotal,
        nextPage: 1,
        loading: false,
        error: '',
      }])))
    }
    catch (error) {
      if (version === requestVersionRef.current) {
        setLoadError((error as Error).message)
      }
    }
    finally {
      if (version === requestVersionRef.current) {
        setLoading(false)
      }
    }
  }, [debouncedQuery])

  useEffect(() => {
    void loadWorkspaces()
  }, [loadWorkspaces])

  useEffect(() => {
    const eventSubscriptions = getAppEventSubscriptions()
    const refresh = () => void loadWorkspaces()
    return eventSubscriptions.subscribe('conversation:updated', refresh)
  }, [loadWorkspaces])

  const loadPage = useCallback(async (workspacePath: string | null, reset = false) => {
    const workspaceKey = getWorkspaceKey(workspacePath)
    const current = pages[workspaceKey]
    if (current?.loading || (!reset && current && current.data.length >= current.total)) {
      return
    }

    const pageIndex = reset ? 0 : current?.nextPage ?? 0
    const version = requestVersionRef.current
    setPages(prev => ({
      ...prev,
      [workspaceKey]: {
        data: reset ? [] : prev[workspaceKey]?.data ?? [],
        total: prev[workspaceKey]?.total ?? 0,
        nextPage: pageIndex,
        loading: true,
        error: '',
      },
    }))

    try {
      const result = await chatApi.getArchivedConversations(workspacePath, pageIndex, PAGE_SIZE, debouncedQuery)
      if (version !== requestVersionRef.current) {
        return
      }
      setPages(prev => ({
        ...prev,
        [workspaceKey]: {
          data: reset ? result.data : mergeConversations(prev[workspaceKey]?.data ?? [], result.data),
          total: result.total,
          nextPage: pageIndex + 1,
          loading: false,
          error: '',
        },
      }))
    }
    catch (error) {
      if (version !== requestVersionRef.current) {
        return
      }
      setPages(prev => ({
        ...prev,
        [workspaceKey]: {
          data: prev[workspaceKey]?.data ?? [],
          total: prev[workspaceKey]?.total ?? 0,
          nextPage: pageIndex,
          loading: false,
          error: (error as Error).message,
        },
      }))
    }
  }, [debouncedQuery, pages])

  async function restoreConversation(conversation: IConversations) {
    try {
      await chatApi.restoreConversation(conversation.id)
      toast.success(`已取消归档「${conversation.title}」`)
      await loadWorkspaces()
    }
    catch (error) {
      toast.error(`取消归档失败：${(error as Error).message}`)
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) {
      return
    }
    setDeleting(true)
    try {
      const deletedIds = deleteTarget.type === 'conversation'
        ? await chatApi.deleteArchivedConversation(deleteTarget.id)
        : deleteTarget.type === 'workspace'
          ? await chatApi.deleteArchivedWorkspaceConversations(deleteTarget.workspacePath)
          : await chatApi.deleteAllArchivedConversations()
      deletedIds.forEach(clearConversationPendingMessages)
      toast.success(`已永久删除 ${deletedIds.length} 个会话`)
      setDeleteTarget(null)
      await loadWorkspaces()
    }
    catch (error) {
      toast.error(`删除失败：${(error as Error).message}`)
    }
    finally {
      setDeleting(false)
    }
  }

  const visibleWorkspaces = workspaceFilter === ALL_WORKSPACES_FILTER
    ? workspaces
    : workspaces.filter(workspace => getWorkspaceKey(workspace.workspacePath) === workspaceFilter)

  return (
    <SettingsPageLayout
      title="已归档的会话"
      description="归档会话不会丢失内容，取消归档后会回到原工作区。"
      actions={(
        <Button
          variant="destructive"
          disabled={totalArchived === 0}
          onClick={() => setDeleteTarget({ type: 'all', count: totalArchived })}
        >
          <Trash2Icon className="size-4" data-icon="inline-start" />
          全部删除
        </Button>
      )}
      variant="wide"
    >

      <div className="flex shrink-0 items-center gap-2">
        <InputGroup className="min-w-0 flex-1 bg-card/60">
          <InputGroupAddon><SearchIcon className="size-4" /></InputGroupAddon>
          <InputGroupInput
            aria-label="搜索已归档的会话"
            placeholder="搜索已归档的会话"
            value={query}
            onChange={event => setQuery(event.target.value)}
          />
        </InputGroup>
        <Select
          items={[
            { label: '全部工作区', value: ALL_WORKSPACES_FILTER },
            ...workspaceOptions.map(workspace => ({
              label: workspace.displayName,
              value: getWorkspaceKey(workspace.workspacePath),
            })),
          ]}
          value={workspaceFilter}
          onValueChange={(value) => {
            if (value) {
              setWorkspaceFilter(value)
            }
          }}
        >
          <SelectTrigger className="w-52" size="sm" aria-label="筛选工作区">
            <FolderIcon className="size-4 text-muted-foreground" />
            <SelectValue placeholder="全部工作区" />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectGroup>
              <SelectItem value={ALL_WORKSPACES_FILTER}>全部工作区</SelectItem>
              {workspaceOptions.map(workspace => (
                <SelectItem key={getWorkspaceKey(workspace.workspacePath)} value={getWorkspaceKey(workspace.workspacePath)}>
                  {workspace.displayName}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      <ScrollArea className="min-h-0 flex-1 rounded-xl border border-border/70 bg-card/30">
        {loading
          ? <div className="flex h-24 items-center justify-center"><Spinner /></div>
          : loadError
            ? (
                <EmptyState title="无法加载已归档的会话" description={loadError}>
                  <Button variant="outline" onClick={() => void loadWorkspaces()}>重试</Button>
                </EmptyState>
              )
            : visibleWorkspaces.length === 0
              ? (
                  <EmptyState
                    icon={<ArchiveIcon className="size-5!" />}
                    title={debouncedQuery || workspaceFilter !== ALL_WORKSPACES_FILTER ? '未找到匹配的已归档会话' : '暂无已归档的会话'}
                    description={debouncedQuery || workspaceFilter !== ALL_WORKSPACES_FILTER ? '尝试调整关键词或工作区筛选。' : '归档后的会话会按工作区显示在这里。'}
                  />
                )
              : visibleWorkspaces.map((workspace) => {
                  const workspaceKey = getWorkspaceKey(workspace.workspacePath)
                  const page = pages[workspaceKey]
                  return (
                    <section key={workspaceKey} className="border-b border-border/70 last:border-b-0">
                      <header className="sticky top-0 z-10 flex h-11 items-center justify-between gap-3 border-b border-border/70 bg-background/95 px-4 backdrop-blur-sm">
                        <div className="flex min-w-0 items-center gap-2">
                          <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
                          <span className="truncate text-sm font-medium">{workspace.displayName}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {debouncedQuery && workspace.matchedTotal !== workspace.total
                              ? `${workspace.matchedTotal} / ${workspace.total} 个会话`
                              : `${workspace.total} 个会话`}
                          </span>
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger render={(
                            <Button variant="ghost" size="icon-xs" aria-label={`管理工作区：${workspace.displayName}`}>
                              <EllipsisIcon className="size-3.5" />
                            </Button>
                          )}
                          />
                          <DropdownMenuContent align="end" className="w-max">
                            <DropdownMenuGroup>
                              <DropdownMenuItem
                                variant="destructive"
                                onClick={() => setDeleteTarget({
                                  type: 'workspace',
                                  workspacePath: workspace.workspacePath,
                                  title: workspace.displayName,
                                  count: workspace.total,
                                })}
                              >
                                <Trash2Icon className="size-4" />
                                清空归档会话
                              </DropdownMenuItem>
                            </DropdownMenuGroup>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </header>

                      {!workspace.available && (
                        <p className="mx-4 mt-3 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
                          {workspace.workspacePath === null
                            ? '这些会话没有关联工作区，当前只能永久删除。'
                            : '原工作区目录不存在或无权访问，当前只能永久删除会话。'}
                        </p>
                      )}
                      <div className="divide-y divide-border/70 px-4">
                        {page?.data.map(conversation => (
                          <ArchivedConversationRow
                            key={conversation.id}
                            conversation={conversation}
                            canRestore={workspace.available}
                            onRestore={() => void restoreConversation(conversation)}
                            onDelete={() => setDeleteTarget({ type: 'conversation', id: conversation.id, title: conversation.title, count: 1 })}
                          />
                        ))}
                      </div>
                      {page?.error
                        ? (
                            <div className="flex items-center justify-center gap-2 py-3 text-xs text-destructive">
                              <span>
                                加载失败：
                                {page.error}
                              </span>
                              <Button variant="ghost" size="xs" onClick={() => void loadPage(workspace.workspacePath)}>重试</Button>
                            </div>
                          )
                        : null}
                      {page && page.data.length < page.total
                        ? <LoadMoreSentinel loading={page.loading} onVisible={() => void loadPage(workspace.workspacePath)} />
                        : page?.loading
                          ? <div className="flex justify-center py-3"><Spinner /></div>
                          : null}
                    </section>
                  )
                })}
      </ScrollArea>

      <DeleteArchivedDialog
        target={deleteTarget}
        deleting={deleting}
        onOpenChange={open => !open && setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
      />
    </SettingsPageLayout>
  )
}

function ArchivedConversationRow({
  conversation,
  canRestore,
  onRestore,
  onDelete,
}: {
  conversation: IConversations
  canRestore: boolean
  onRestore: () => void
  onDelete: () => void
}) {
  return (
    <div className="group/conversation flex min-h-16 items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{conversation.title}</p>
        <time className="mt-1 block text-xs text-muted-foreground tabular-nums" dateTime={new Date(conversation.updatedAt).toISOString()}>
          {formatTime(conversation.updatedAt)}
        </time>
      </div>
      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover/conversation:opacity-100 focus-within:opacity-100">
        <Tooltip>
          <TooltipTrigger
            render={(
              <span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={!canRestore}
                  aria-label={`取消归档：${conversation.title}`}
                  onClick={onRestore}
                >
                  <RotateCcwIcon className="size-3.5" />
                </Button>
              </span>
            )}
          />
          <TooltipContent>{canRestore ? '取消归档' : '原工作区不可用'}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger render={(
            <Button variant="ghost" size="icon-sm" aria-label={`删除已归档会话：${conversation.title}`} onClick={onDelete}>
              <Trash2Icon className="size-3.5" />
            </Button>
          )}
          />
          <TooltipContent>永久删除</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}

function LoadMoreSentinel({ loading, onVisible }: { loading: boolean, onVisible: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const onVisibleRef = useRef(onVisible)
  onVisibleRef.current = onVisible

  useEffect(() => {
    const element = ref.current
    if (!element || loading || typeof IntersectionObserver === 'undefined') {
      return
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some(entry => entry.isIntersecting)) {
        onVisibleRef.current()
      }
    }, { rootMargin: '200px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [loading])

  return (
    <div ref={ref} className="flex justify-center py-3">
      {loading
        ? <Spinner />
        : <Button variant="ghost" size="xs" onClick={onVisible}>加载更多</Button>}
    </div>
  )
}

function DeleteArchivedDialog({
  target,
  deleting,
  onOpenChange,
  onConfirm,
}: {
  target: DeleteTarget | null
  deleting: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  const subject = target?.type === 'conversation'
    ? `会话「${target.title}」`
    : target?.type === 'workspace'
      ? target.workspacePath === null
        ? `“未关联工作区”分组中的 ${target.count} 个已归档会话`
        : `工作区「${target.title}」中的 ${target.count} 个已归档会话`
      : `全部 ${target?.count ?? 0} 个已归档会话`

  return (
    <AlertDialog open={Boolean(target)} onOpenChange={onOpenChange}>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>永久删除已归档会话</AlertDialogTitle>
          <AlertDialogDescription>
            确定永久删除
            {subject}
            吗？相关消息和附件也会被删除，此操作无法撤销。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="px-4 py-2">
          <AlertDialogCancel size="sm" disabled={deleting}>取消</AlertDialogCancel>
          <AlertDialogAction size="sm" variant="destructive" disabled={deleting} onClick={onConfirm}>
            {deleting ? '删除中...' : '永久删除'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function mergeConversations(current: IConversations[], incoming: IConversations[]): IConversations[] {
  const ids = new Set(current.map(item => item.id))
  return [...current, ...incoming.filter(item => !ids.has(item.id))]
}

function getWorkspaceKey(workspacePath: string | null): string {
  return workspacePath === null ? UNASSIGNED_WORKSPACE_KEY : `workspace:${workspacePath}`
}
