import type {
  IConversations,
  ListWorkspacesData,
  WorkspaceItem,
} from '@ant-chat/shared'
import { Button } from '@workspace/ui/components/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@workspace/ui/components/tooltip'
import {
  FolderIcon,
  FolderOpenIcon,
  PencilIcon,
  PlusIcon,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import workspaceApi from '@/api/workspaceApi'
import {
  ensureWorkspaceConversationsAction,
  nextPageConversationsAction,
  switchWorkspaceConversationsAction,
  useConversationsStore,
} from '@/store/conversation'
import { setActiveConversationsId, useMessagesStore } from '@/store/messages'

interface WorkspaceConversationState {
  data: IConversations[]
  total: number
  loading: boolean
}

export function WorkspacePanels() {
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
  const [workspaceData, setWorkspaceData] = useState<ListWorkspacesData | null>(
    null,
  )
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(
    () => new Set(),
  )
  const [panelError, setPanelError] = useState('')
  const initializedRef = useRef(false)

  const currentWorkspacePath = storeWorkspacePath || workspaceData?.currentWorkspacePath

  async function initialize() {
    if (initializedRef.current) {
      return
    }

    initializedRef.current = true
    const data = await workspaceApi.listWorkspaces()
    setWorkspaceData(data)
    setExpandedPaths(new Set([data.currentWorkspacePath]))
    useConversationsStore.getState().switchWorkspace(data.currentWorkspacePath)

    if (useConversationsStore.getState().conversations.length === 0) {
      await nextPageConversationsAction()
    }
  }

  const reloadCurrentWorkspace = useCallback(async () => {
    await setActiveConversationsId('')
    if (currentWorkspacePath) {
      await switchWorkspaceConversationsAction(currentWorkspacePath)
    }
  }, [currentWorkspacePath])

  const handleChooseWorkspace = useCallback(async () => {
    setPanelError('')
    try {
      const data = await workspaceApi.chooseWorkspace()
      if (!data) {
        return
      }

      setWorkspaceData(data)
      setExpandedPaths(
        paths => new Set([...paths, data.currentWorkspacePath]),
      )
      await reloadCurrentWorkspace()
    }
    catch (error) {
      setPanelError((error as Error).message)
    }
  }, [reloadCurrentWorkspace])

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
      const data = await workspaceApi.openWorkspace(workspacePath)
      setWorkspaceData(data)
      setExpandedPaths(
        paths => new Set([...paths, data.currentWorkspacePath]),
      )
      await switchWorkspaceConversationsAction(workspacePath)
    }

    await setActiveConversationsId(conversationId)
  }

  async function createConversation(workspacePath: string) {
    navigate('/chat')

    if (workspacePath !== currentWorkspacePath) {
      const data = await workspaceApi.openWorkspace(workspacePath)
      setWorkspaceData(data)
      setExpandedPaths(paths => new Set([...paths, data.currentWorkspacePath]))
      await switchWorkspaceConversationsAction(workspacePath)
    }

    await setActiveConversationsId('')
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
  }, [])

  const workspaces = workspaceData?.workspaces || []

  return (
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
}

function WorkspacePanel({
  item,
  activeConversationId,
  expanded,
  state,
  onToggle,
  onOpenConversation,
  onCreateConversation,
}: WorkspacePanelProps) {
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
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className={`
                opacity-0
                group-hover:opacity-100
              `}
              onClick={(event) => {
                event.stopPropagation()
                void onCreateConversation(item.path)
              }}
            >
              <PencilIcon className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <span>新建对话</span>
          </TooltipContent>
        </Tooltip>
      </div>

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
