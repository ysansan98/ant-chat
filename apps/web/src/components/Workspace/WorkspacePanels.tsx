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
import { activateWorkspace, deleteConversationsAction, ensureWorkspaceConversationsAction, renameConversationsAction, useConversationsStore } from '@/store/conversation'
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
        <div className="flex items-center justify-between px-2 text-xs font-medium text-slate-400">
          <span>工作区</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                type="button"
                onClick={handleChooseWorkspace}
              >
                <PlusIcon className="size-4" />
              </Button>
            </TooltipTrigger>
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
                                  onToggle={toggleWorkspace}
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
                <div className="px-3 py-8 text-center text-sm text-slate-400">
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
  onToggle: (item: WorkspaceItem) => void
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
  onToggle,
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
          active:cursor-grabbing
          hover:bg-black/5
          dark:hover:bg-white/10
          ${dragging ? 'opacity-50 shadow-sm' : ''}
        `}
        {...dragHandleProps}
      >
        <button
          type="button"
          className={`
            flex min-w-0 flex-1 items-center justify-start font-medium text-slate-600
            dark:text-slate-300
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
          <DropdownMenuTrigger asChild>
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
          </DropdownMenuTrigger>
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
                    <div className="px-3 py-2 text-sm text-slate-400">加载中...</div>
                  )
                : state?.data?.length
                  ? (
                      state?.data.map(conversation => (
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
                      <div className="px-3 py-2 text-sm text-slate-400">暂无会话</div>
                    )}
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

  return (
    <>
      <div
        className={`
          group/conversation flex py-1.5 w-full items-center rounded-md px-2 text-[14px]
          transition-colors duration-150 hover:bg-black/5 dark:hover:bg-white/10
          mt-1
          ${active
      ? 'bg-black/5 font-medium text-slate-700 dark:bg-white/10 dark:text-slate-200'
      : 'text-slate-600 dark:text-slate-400'}
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
              : <span className="tabular-nums text-[11px] text-slate-400 transition-[opacity,transform,filter] duration-150 group-hover/conversation:pointer-events-none group-hover/conversation:scale-25 group-hover/conversation:opacity-0 group-hover/conversation:blur-[4px]">{formatRelativeTime(conversation.updatedAt)}</span>}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={`管理对话：${conversation.title}`}
                className="absolute right-0 scale-25 opacity-0 blur-[4px] transition-[opacity,transform,filter] duration-150 group-hover/conversation:scale-100 group-hover/conversation:opacity-100 group-hover/conversation:blur-none data-[state=open]:scale-100 data-[state=open]:opacity-100 data-[state=open]:blur-none"
              >
                <Ellipsis className="size-4" />
              </Button>
            </DropdownMenuTrigger>
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
