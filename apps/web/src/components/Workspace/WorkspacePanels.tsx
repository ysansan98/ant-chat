import type {
  IConversations,
  WorkspaceItem,
} from '@ant-chat/shared'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@workspace/ui/components/alert-dialog'
import { Button } from '@workspace/ui/components/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@workspace/ui/components/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@workspace/ui/components/tooltip'
import {
  Ellipsis,
  FolderIcon,
  FolderOpenIcon,
  PencilIcon,
  PlusIcon,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import {
  ensureWorkspaceConversationsAction,
  nextPageConversationsAction,
  switchWorkspaceConversationsAction,
  useConversationsStore,
} from '@/store/conversation'
import { setActiveConversationsId, useMessagesStore } from '@/store/messages'
import { useWorkspaceStore } from '@/store/workspace'
import { WorkspaceDirectoryPickerDialog } from './WorkspaceDirectoryPickerDialog'

interface WorkspaceConversationState {
  data: IConversations[]
  total: number
  loading: boolean
}

interface WorkspacePanelsProps {
  onNavigate?: () => void
}

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
  const storeWorkspacePath = useConversationsStore(
    state => state.currentWorkspacePath,
  )
  const activeConversationsId = useMessagesStore(
    state => state.activeConversationsId,
  )
  const workspaceData = useWorkspaceStore(state => state.workspaceData)
  const refreshWorkspace = useWorkspaceStore(state => state.refresh)
  const openWorkspace = useWorkspaceStore(state => state.openWorkspace)
  const addWorkspace = useWorkspaceStore(state => state.addWorkspace)
  const removeWorkspace = useWorkspaceStore(state => state.removeWorkspace)
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(
    () => new Set(),
  )
  const [panelError, setPanelError] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const initializedRef = useRef(false)

  const currentWorkspacePath = storeWorkspacePath || workspaceData?.currentWorkspacePath

  const initialize = useCallback(async () => {
    if (initializedRef.current) {
      return
    }

    initializedRef.current = true
    await refreshWorkspace()
    const data = useWorkspaceStore.getState().workspaceData
    if (data) {
      setExpandedPaths(new Set([data.currentWorkspacePath]))
      useConversationsStore.getState().switchWorkspace(data.currentWorkspacePath)

      if (useConversationsStore.getState().conversations.length === 0) {
        await nextPageConversationsAction()
      }
    }
  }, [refreshWorkspace])

  const reloadCurrentWorkspace = useCallback(async () => {
    await setActiveConversationsId('')
    if (currentWorkspacePath) {
      await switchWorkspaceConversationsAction(currentWorkspacePath)
    }
  }, [currentWorkspacePath])

  const handleChooseWorkspace = useCallback(() => {
    setPickerOpen(true)
  }, [])

  const handlePickerConfirm = useCallback(async (path: string) => {
    setPickerOpen(false)
    setPanelError('')
    try {
      const data = await addWorkspace(path)
      setExpandedPaths(
        paths => new Set([...paths, data.currentWorkspacePath]),
      )
      await reloadCurrentWorkspace()
    }
    catch (error) {
      setPanelError((error as Error).message)
    }
  }, [addWorkspace, reloadCurrentWorkspace])

  const handleDeleteWorkspace = useCallback(async (path: string) => {
    try {
      await removeWorkspace(path)
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
      const data = await openWorkspace(workspacePath)
      setExpandedPaths(
        paths => new Set([...paths, data.currentWorkspacePath]),
      )
      await switchWorkspaceConversationsAction(workspacePath)
    }

    await setActiveConversationsId(conversationId)
    onNavigate?.()
  }

  async function createConversation(workspacePath: string) {
    navigate('/chat')

    if (workspacePath !== currentWorkspacePath) {
      const data = await openWorkspace(workspacePath)
      setExpandedPaths(paths => new Set([...paths, data.currentWorkspacePath]))
      await switchWorkspaceConversationsAction(workspacePath)
    }

    await setActiveConversationsId('')
    onNavigate?.()
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

  const workspaces = workspaceData?.workspaces || []

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
          {workspaces.length > 0
            ? (
                workspaces.map(item => (
                  <WorkspacePanel
                    key={item.path}
                    item={item}
                    activeConversationId={activeConversationsId}
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
                  />
                ))
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
  expanded: boolean
  state?: WorkspaceConversationState
  onToggle: (item: WorkspaceItem) => void
  onOpenConversation: (workspacePath: string, conversationId: string) => void
  onCreateConversation: (workspacePath: string) => void
  onDeleteWorkspace: (path: string) => void
}

function WorkspacePanel({
  item,
  activeConversationId,
  expanded,
  state,
  onToggle,
  onOpenConversation,
  onCreateConversation,
  onDeleteWorkspace,
}: WorkspacePanelProps) {
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)

  return (
    <div className="mb-1">
      <div className="
        group flex h-9 w-full items-center gap-1 rounded-md px-2
        hover:bg-black/5
        dark:hover:bg-white/10
      "
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
            <div className="pl-5">
              {state?.loading
                ? (
                    <div className="px-3 py-2 text-sm text-slate-400">加载中...</div>
                  )
                : state?.data?.length
                  ? (
                      state?.data.map((conversation) => {
                        const activeConversationClass
                          = conversation.id === activeConversationId
                            ? 'bg-black/5 font-medium text-slate-700 dark:bg-white/10 dark:text-slate-200'
                            : 'text-slate-600 dark:text-slate-400'

                        return (
                          <button
                            key={conversation.id}
                            type="button"
                            className={`
                              flex h-9 w-full items-center justify-start rounded-md px-3 text-[14px]
                              hover:bg-black/5
                              dark:hover:bg-white/10
                              ${activeConversationClass}
                            `}
                            onClick={() =>
                              onOpenConversation(item.path, conversation.id)}
                          >
                            <span className="flex min-w-0 items-center gap-1">
                              <span className="max-w-40 truncate">
                                {conversation.title}
                              </span>
                            </span>
                          </button>
                        )
                      })
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
