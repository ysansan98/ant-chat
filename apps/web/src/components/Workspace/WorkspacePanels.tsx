import type {
  IConversations,
  WorkspaceItem,
} from '@ant-chat/shared'
import type { DraggableProvidedDragHandleProps, DropResult } from '@hello-pangea/dnd'
import type { CSSProperties } from 'react'
import { DragDropContext, Draggable, Droppable } from '@hello-pangea/dnd'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@workspace/ui/components/alert-dialog'
import { Button } from '@workspace/ui/components/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@workspace/ui/components/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@workspace/ui/components/dropdown-menu'
import { Input } from '@workspace/ui/components/input'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@workspace/ui/components/tooltip'
import {
  ArchiveIcon,
  Ellipsis,
  FolderIcon,
  FolderOpenIcon,
  LoaderCircleIcon,
  PencilIcon,
  PlusIcon,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { activateWorkspace, archiveConversationAction, deleteConversationsAction, ensureWorkspaceConversationsAction, loadAllWorkspaceConversationsAction, renameConversationsAction, restoreConversationAction, useConversationsStore } from '@/store/conversation'
import { setActiveConversationsId, useMessagesStore } from '@/store/messages'
import { useWorkspaceStore } from '@/store/workspace'
import { formatRelativeTime } from '@/utils'
import { WorkspaceDirectoryPickerDialog } from './WorkspaceDirectoryPickerDialog'

interface WorkspaceConversationState {
  data: IConversations[]
  total: number
  loading: boolean
}

interface WorkspacePanelsProps {
  onNavigate?: () => void
}

const EMPTY_WORKSPACES: WorkspaceItem[] = []

export function WorkspacePanels({ onNavigate }: WorkspacePanelsProps) {
  const navigate = useNavigate()
  const currentConversations = useConversationsStore(
    state => state.conversations,
  )
  const currentConversationsTotal = useConversationsStore(
    state => state.conversationsTotal,
  )
  const workspaceConversations = useConversationsStore(
    state => state.workspaceConversations,
  )
  const workspaceData = useWorkspaceStore(state => state.workspaceData)
  const currentWorkspacePath = useWorkspaceStore(state => state.currentWorkspacePath)
  const refreshWorkspace = useWorkspaceStore(state => state.refresh)
  const openWorkspace = useWorkspaceStore(state => state.openWorkspace)
  const addWorkspace = useWorkspaceStore(state => state.addWorkspace)
  const removeWorkspace = useWorkspaceStore(state => state.removeWorkspace)
  const reorderWorkspaces = useWorkspaceStore(state => state.reorderWorkspaces)
  const activeConversationsId = useMessagesStore(
    state => state.activeConversationsId,
  )
  const conversationStates = useConversationsStore(state => state.conversationStates)
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(
    () => new Set(),
  )
  const [showAllPaths, setShowAllPaths] = useState<Set<string>>(() => new Set())
  const [loadingAllPaths, setLoadingAllPaths] = useState<Set<string>>(() => new Set())
  const [panelError, setPanelError] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [optimisticWorkspacePaths, setOptimisticWorkspacePaths] = useState<string[] | null>(null)
  const initializedRef = useRef(false)
  const workspaces = workspaceData?.workspaces ?? EMPTY_WORKSPACES
  const visibleWorkspaces = optimisticWorkspacePaths
    ? orderWorkspacesByPaths(workspaces, optimisticWorkspacePaths)
    : workspaces

  const initialize = useCallback(async () => {
    if (initializedRef.current) {
      return
    }

    initializedRef.current = true
    await refreshWorkspace()
    const data = useWorkspaceStore.getState().workspaceData
    if (data) {
      const currentPath = useWorkspaceStore.getState().currentWorkspacePath
      setExpandedPaths(new Set([currentPath]))
      await activateWorkspace(currentPath)
    }
  }, [refreshWorkspace])

  const handleChooseWorkspace = useCallback(() => {
    setPickerOpen(true)
  }, [])

  const handlePickerConfirm = useCallback(async (path: string) => {
    setPickerOpen(false)
    setPanelError('')
    try {
      await addWorkspace(path)
      // addWorkspace 内部已 set currentWorkspacePath=path(SSOT 更新),
      // 用入参 path 调 activateWorkspace,不依赖闭包渲染期变量
      setExpandedPaths(paths => new Set([...paths, path]))
      await activateWorkspace(path)
    }
    catch (error) {
      setPanelError((error as Error).message)
    }
  }, [addWorkspace])

  const handleDeleteWorkspace = useCallback(async (path: string) => {
    try {
      await removeWorkspace(path)
      // removeWorkspace 内部已按 lastOpenedAt 回退 currentWorkspacePath,
      // 从 workspaceStore 取回退后的当前路径再 activate
      await activateWorkspace(useWorkspaceStore.getState().currentWorkspacePath)
      setExpandedPaths((paths) => {
        const next = new Set(paths)
        next.delete(path)
        return next
      })
    }
    catch (error) {
      setPanelError((error as Error).message)
    }
  }, [removeWorkspace])

  async function toggleWorkspace(item: WorkspaceItem) {
    const nextExpandedPaths = new Set(expandedPaths)
    if (nextExpandedPaths.has(item.path)) {
      nextExpandedPaths.delete(item.path)
      setExpandedPaths(nextExpandedPaths)
      return
    }

    nextExpandedPaths.add(item.path)
    setExpandedPaths(nextExpandedPaths)

    if (
      item.path !== currentWorkspacePath
      && !workspaceConversations[item.path]?.loaded
    ) {
      await ensureWorkspaceConversationsAction(item.path)
    }
  }

  async function toggleAllConversations(workspacePath: string) {
    if (showAllPaths.has(workspacePath)) {
      setShowAllPaths(paths => withoutPath(paths, workspacePath))
      return
    }

    setLoadingAllPaths(paths => new Set(paths).add(workspacePath))
    try {
      await loadAllWorkspaceConversationsAction(workspacePath)
      setShowAllPaths(paths => new Set(paths).add(workspacePath))
    }
    catch (error) {
      toast.error(`加载全部会话失败：${(error as Error).message}`)
    }
    finally {
      setLoadingAllPaths(paths => withoutPath(paths, workspacePath))
    }
  }

  async function openConversation(
    workspacePath: string,
    conversationId: string,
  ) {
    navigate('/chat')

    if (workspacePath !== currentWorkspacePath) {
      await openWorkspace(workspacePath)
      setExpandedPaths(paths => new Set([...paths, workspacePath]))
      await activateWorkspace(workspacePath)
    }

    await setActiveConversationsId(conversationId)
    onNavigate?.()
  }

  async function createConversation(workspacePath: string) {
    navigate('/chat')

    if (workspacePath !== currentWorkspacePath) {
      await openWorkspace(workspacePath)
      setExpandedPaths(paths => new Set([...paths, workspacePath]))
      await activateWorkspace(workspacePath)
    }

    await setActiveConversationsId('')
    onNavigate?.()
  }

  async function persistWorkspaceOrder(nextWorkspaces: WorkspaceItem[]) {
    const nextPaths = nextWorkspaces.map(item => item.path)
    const currentPaths = visibleWorkspaces.map(item => item.path)
    if (nextPaths.every((path, index) => path === currentPaths[index])) {
      return
    }

    setOptimisticWorkspacePaths(nextPaths)
    try {
      setPanelError('')
      await reorderWorkspaces(nextPaths)
      setOptimisticWorkspacePaths(null)
    }
    catch (error) {
      setPanelError((error as Error).message)
      setOptimisticWorkspacePaths(null)
      await refreshWorkspace()
    }
  }

  function handleDragEnd(result: DropResult) {
    if (!result.destination || result.source.index === result.destination.index) {
      return
    }

    void persistWorkspaceOrder(reorderWorkspaceItems(
      visibleWorkspaces,
      result.source.index,
      result.destination.index,
    ))
  }

  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(() => {
      if (!cancelled) {
        void initialize()
      }
    }, 0)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [initialize])

  return (
    <>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center justify-between px-2 text-xs font-medium text-sidebar-foreground/60">
          <span>工作区</span>
          <Tooltip>
            <TooltipTrigger render={(
              <Button
                variant="ghost"
                size="icon-xs"
                type="button"
                onClick={handleChooseWorkspace}
              >
                <PlusIcon className="size-4" />
              </Button>
            )}
            />
            <TooltipContent>
              <span>
                添加工作区
              </span>
            </TooltipContent>
          </Tooltip>
        </div>

        {panelError
          ? <div className="mt-2 px-2 text-xs text-red-500">{panelError}</div>
          : null}

        <div className="mt-2 min-h-0 flex-1 overflow-y-auto pr-1">
          {visibleWorkspaces.length > 0
            ? (
                <DragDropContext onDragEnd={handleDragEnd}>
                  <Droppable droppableId="workspace-list">
                    {provided => (
                      <div ref={provided.innerRef} {...provided.droppableProps}>
                        {visibleWorkspaces.map((item, index) => (
                          <Draggable
                            key={item.path}
                            draggableId={item.path}
                            index={index}
                            disableInteractiveElementBlocking
                          >
                            {(draggableProvided, snapshot) => (
                              <div
                                ref={draggableProvided.innerRef}
                                {...draggableProvided.draggableProps}
                                style={draggableProvided.draggableProps.style as CSSProperties | undefined}
                              >
                                <WorkspacePanel
                                  item={item}
                                  activeConversationId={activeConversationsId}
                                  conversationStates={conversationStates}
                                  expanded={expandedPaths.has(item.path)}
                                  state={getWorkspaceConversationState(
                                    item.path,
                                    currentWorkspacePath,
                                    currentConversations,
                                    currentConversationsTotal,
                                    workspaceConversations,
                                  )}
                                  showAll={showAllPaths.has(item.path)}
                                  loadingAll={loadingAllPaths.has(item.path)}
                                  onToggle={toggleWorkspace}
                                  onToggleAll={toggleAllConversations}
                                  onOpenConversation={openConversation}
                                  onCreateConversation={createConversation}
                                  onDeleteWorkspace={handleDeleteWorkspace}
                                  dragging={snapshot.isDragging}
                                  dragHandleProps={draggableProvided.dragHandleProps}
                                />
                              </div>
                            )}
                          </Draggable>
                        ))}
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                </DragDropContext>
              )
            : (
                <div className="px-3 py-8 text-center text-sm text-sidebar-foreground/60">
                  暂无工作区
                </div>
              )}
        </div>

      </div>

      <WorkspaceDirectoryPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onConfirm={handlePickerConfirm}
      />
    </>
  )
}

interface WorkspacePanelProps {
  item: WorkspaceItem
  activeConversationId: string
  conversationStates: Record<string, 'running' | 'completed'>
  expanded: boolean
  state?: WorkspaceConversationState
  showAll: boolean
  loadingAll: boolean
  onToggle: (item: WorkspaceItem) => void
  onToggleAll: (workspacePath: string) => void
  onOpenConversation: (workspacePath: string, conversationId: string) => void
  onCreateConversation: (workspacePath: string) => void
  onDeleteWorkspace: (path: string) => void
  dragging: boolean
  dragHandleProps: DraggableProvidedDragHandleProps | null
}

function WorkspacePanel({
  item,
  activeConversationId,
  conversationStates,
  expanded,
  state,
  showAll,
  loadingAll,
  onToggle,
  onToggleAll,
  onOpenConversation,
  onCreateConversation,
  onDeleteWorkspace,
  dragging,
  dragHandleProps,
}: WorkspacePanelProps) {
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)

  return (
    <div className="mb-1">
      <div
        className={`
          group flex h-9 w-full cursor-grab items-center gap-1 rounded-md px-2 transition
          hover:bg-sidebar-accent
          active:cursor-grabbing
          ${dragging ? 'opacity-50 shadow-sm' : ''}
        `}
        {...dragHandleProps}
      >
        <button
          type="button"
          className={`
            flex min-w-0 flex-1 items-center justify-start font-medium text-sidebar-foreground/80
          `}
          onClick={() => onToggle(item)}
        >
          <span className="flex min-w-0 items-center gap-2">
            {expanded
              ? <FolderOpenIcon className="size-4 shrink-0" />
              : <FolderIcon className="size-4 shrink-0" />}
            <span className="max-w-42 truncate">
              {item.displayName}
            </span>
          </span>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger render={(
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="opacity-0 group-hover:opacity-100"
              onPointerDown={event => event.stopPropagation()}
              onMouseDown={event => event.stopPropagation()}
              onTouchStart={event => event.stopPropagation()}
              onClick={event => event.stopPropagation()}
            >
              <Ellipsis className="size-4" />
            </Button>
          )}
          />
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={(event) => {
                event.stopPropagation()
                void onCreateConversation(item.path)
              }}
            >
              <PencilIcon className="size-4" />
              新建对话
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onClick={(event) => {
                event.stopPropagation()
                setDeleteConfirmOpen(true)
              }}
            >
              <Trash2 className="size-4" />
              删除工作区
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent size="sm" onClick={event => event.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>删除工作区</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除工作区「
              {item.displayName}
              」吗？此操作不会删除磁盘上的文件，仅从列表中移除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="px-4 py-2">
            <AlertDialogCancel size="sm">取消</AlertDialogCancel>
            <AlertDialogAction size="sm" variant="destructive" onClick={() => onDeleteWorkspace(item.path)}>
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {expanded
        ? (
            <div className="pl-0">
              {state?.loading
                ? (
                    <div className="px-3 py-2 text-sm text-sidebar-foreground/60">加载中...</div>
                  )
                : state?.data?.length
                  ? (
                      (showAll ? state.data : state.data.slice(0, 5)).map(conversation => (
                        <ConversationListItem
                          key={conversation.id}
                          conversation={conversation}
                          active={conversation.id === activeConversationId}
                          running={conversationStates[conversation.id] === 'running'}
                          completed={conversationStates[conversation.id] === 'completed'}
                          onOpen={() => onOpenConversation(item.path, conversation.id)}
                        />
                      ))
                    )
                  : (
                      <div className="px-3 py-2 text-sm text-sidebar-foreground/60">暂无会话</div>
                    )}
              {state && state.total > 5
                ? (
                    <button
                      type="button"
                      className="mt-1 inline-flex px-3.5 py-1.5 text-left text-xs text-sidebar-foreground/60 transition-colors hover:text-sidebar-foreground disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={loadingAll}
                      onClick={() => onToggleAll(item.path)}
                    >
                      {loadingAll ? '加载中...' : showAll ? '收起' : `查看全部（${state.total}）`}
                    </button>
                  )
                : null}
            </div>
          )
        : null}
    </div>
  )
}

interface ConversationListItemProps {
  conversation: IConversations
  active: boolean
  running: boolean
  completed: boolean
  onOpen: () => void
}

function ConversationListItem({ conversation, active, running, completed, onOpen }: ConversationListItemProps) {
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [title, setTitle] = useState(conversation.title)
  const [submitting, setSubmitting] = useState(false)
  const status = running ? 'running' : completed && !active ? 'completed' : null

  async function handleRename() {
    const nextTitle = title.trim()
    if (!nextTitle || nextTitle === conversation.title) {
      setRenameOpen(false)
      return
    }

    setSubmitting(true)
    try {
      await renameConversationsAction(conversation.id, nextTitle)
      setRenameOpen(false)
    }
    catch (error) {
      toast.error(`重命名失败：${(error as Error).message}`)
    }
    finally {
      setSubmitting(false)
    }
  }

  async function handleDelete() {
    setSubmitting(true)
    try {
      await deleteConversationsAction(conversation.id)
      setDeleteOpen(false)
    }
    catch (error) {
      toast.error(`删除失败：${(error as Error).message}`)
    }
    finally {
      setSubmitting(false)
    }
  }

  async function handleArchive() {
    setSubmitting(true)
    try {
      const result = await archiveConversationAction(conversation.id)
      toast.success('会话已归档', {
        action: {
          label: '撤销',
          onClick: () => {
            void restoreConversationAction(conversation.id)
              .then(() => result.wasActive && onOpen())
              .catch(error => toast.error(`撤销归档失败：${(error as Error).message}`))
          },
        },
      })
    }
    catch (error) {
      toast.error(`归档失败：${(error as Error).message}`)
    }
    finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <div
        className={`
          group/conversation mt-1 flex w-full items-center rounded-md px-2 py-1.5
          text-[14px] transition-colors duration-150 hover:bg-sidebar-accent
          hover:text-sidebar-accent-foreground
          ${active
      ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
      : 'text-sidebar-foreground/80'}
        `}
      >
        <button
          type="button"
          className="min-w-0 flex-1 truncate px-1.5 text-left"
          onClick={onOpen}
        >
          {conversation.title}
        </button>
        <div className="relative flex h-full w-14 shrink-0 items-center justify-end">
          {status === 'running'
            ? <LoaderCircleIcon className="size-3.5 animate-spin text-blue-500" />
            : status === 'completed'
              ? <span className="size-1.5 rounded-full bg-emerald-500" />
              : <span className="text-[11px] text-sidebar-foreground/60 tabular-nums transition-[opacity,transform,filter] duration-150 group-hover/conversation:pointer-events-none group-hover/conversation:scale-25 group-hover/conversation:opacity-0 group-hover/conversation:blur-xs">{formatRelativeTime(conversation.updatedAt)}</span>}
          <Tooltip>
            <TooltipTrigger
              render={(
                <span className="absolute right-6 scale-25 opacity-0 blur-xs transition-[opacity,transform,filter] duration-150 group-hover/conversation:scale-100 group-hover/conversation:opacity-100 group-hover/conversation:blur-none focus-within:scale-100 focus-within:opacity-100 focus-within:blur-none">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`归档对话：${conversation.title}`}
                    disabled={running || submitting}
                    onClick={() => void handleArchive()}
                  >
                    <ArchiveIcon className="size-3" />
                  </Button>
                </span>
              )}
            />
            <TooltipContent>{running ? '任务运行中，暂时无法归档' : '归档对话'}</TooltipContent>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger render={(
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={`管理对话：${conversation.title}`}
                className="absolute right-0 scale-25 opacity-0 blur-xs transition-[opacity,transform,filter] duration-150 group-hover/conversation:scale-100 group-hover/conversation:opacity-100 group-hover/conversation:blur-none data-popup-open:scale-100 data-popup-open:opacity-100 data-popup-open:blur-none"
              >
                <Ellipsis className="size-4" />
              </Button>
            )}
            />
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => {
                setTitle(conversation.title)
                setRenameOpen(true)
              }}
              >
                <PencilIcon className="size-4" />
                重命名对话
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={() => setDeleteOpen(true)}>
                <Trash2 className="size-4" />
                删除对话
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <form onSubmit={(event) => {
            event.preventDefault()
            void handleRename()
          }}
          >
            <DialogHeader>
              <DialogTitle>重命名对话</DialogTitle>
              <DialogDescription>输入一个便于识别的对话名称。</DialogDescription>
            </DialogHeader>
            <Input className="my-4" value={title} onChange={event => setTitle(event.target.value)} autoFocus maxLength={100} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRenameOpen(false)}>取消</Button>
              <Button type="submit" disabled={submitting || !title.trim()}>{submitting ? '保存中...' : '保存'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>删除对话</AlertDialogTitle>
            <AlertDialogDescription>
              确定删除「
              {conversation.title}
              」吗？此操作无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="px-4 py-2">
            <AlertDialogCancel size="sm">取消</AlertDialogCancel>
            <AlertDialogAction size="sm" variant="destructive" disabled={submitting} onClick={() => void handleDelete()}>
              {submitting ? '删除中...' : '删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function getWorkspaceConversationState(
  workspacePath: string,
  currentWorkspacePath: string | undefined,
  currentConversations: IConversations[],
  currentConversationsTotal: number,
  workspaceConversations: ReturnType<typeof useConversationsStore.getState>['workspaceConversations'],
): WorkspaceConversationState {
  if (workspacePath === currentWorkspacePath) {
    return {
      data: currentConversations,
      total: currentConversationsTotal,
      loading: false,
    }
  }

  const slice = workspaceConversations[workspacePath]
  return {
    data: slice?.conversations || [],
    total: slice?.conversationsTotal || 0,
    loading: !slice?.loaded,
  }
}

function reorderWorkspaceItems(
  workspaces: WorkspaceItem[],
  sourceIndex: number,
  targetIndex: number,
): WorkspaceItem[] {
  const nextWorkspaces = [...workspaces]
  const [workspace] = nextWorkspaces.splice(sourceIndex, 1)
  nextWorkspaces.splice(targetIndex, 0, workspace)
  return nextWorkspaces
}

function orderWorkspacesByPaths(
  workspaces: WorkspaceItem[],
  orderedPaths: string[],
): WorkspaceItem[] {
  if (workspaces.length !== orderedPaths.length) {
    return workspaces
  }

  const workspaceByPath = new Map(workspaces.map(item => [item.path, item]))
  const orderedWorkspaces = orderedPaths.map(path => workspaceByPath.get(path))
  if (orderedWorkspaces.some(item => !item)) {
    return workspaces
  }

  return orderedWorkspaces as WorkspaceItem[]
}

function withoutPath(paths: Set<string>, path: string): Set<string> {
  const next = new Set(paths)
  next.delete(path)
  return next
}
