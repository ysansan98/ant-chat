import type { ListWorkspacesData, WorkspaceItem } from '@ant-chat/shared'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@workspace/ui/components/alert-dialog'
import { Button } from '@workspace/ui/components/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@workspace/ui/components/popover'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@workspace/ui/components/tooltip'
import {
  CheckIcon,
  FolderOpenIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react'
import { useEffect, useMemo, useReducer, useState } from 'react'
import workspaceApi from '@/api/workspaceApi'
import {
  emitWorkspaceChanged,
  WORKSPACE_CHANGED_EVENT,
} from '@/constants/workspaceEvents'
import { switchWorkspaceConversationsAction, useConversationsStore } from '@/store/conversation'
import { setActiveConversationsId } from '@/store/messages'

interface WorkspaceSelectorProps {
  compact?: boolean
}

interface NoticeState {
  type: 'success' | 'error'
  message: string
}

export function WorkspaceSelector({ compact = false }: WorkspaceSelectorProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  // useReducer to avoid react-hooks/set-state-in-effect: dispatch is allowed in effects
  const [workspaceData, setWorkspaceData] = useReducer(
    (_s: ListWorkspacesData | null, a: ListWorkspacesData | null) => a,
    null,
  )
  const [notice, setNotice] = useState<NoticeState | null>(null)
  const [removeTarget, setRemoveTarget] = useState<WorkspaceItem | null>(null)
  const compactClass = compact
    ? `
      text-slate-500
      dark:text-slate-400
    `
    : ''

  const currentWorkspace = useMemo(
    () => workspaceData?.workspaces.find(item => item.path === workspaceData.currentWorkspacePath),
    [workspaceData],
  )

  async function refreshWorkspaces() {
    const data = await workspaceApi.listWorkspaces()
    setWorkspaceData(data)
    useConversationsStore.getState().switchWorkspace(data.currentWorkspacePath)
  }

  useEffect(() => {
    void refreshWorkspaces()
  }, [])

  useEffect(() => {
    const onWorkspaceChanged = () => {
      void refreshWorkspaces()
    }

    window.addEventListener(WORKSPACE_CHANGED_EVENT, onWorkspaceChanged)
    return () => {
      window.removeEventListener(WORKSPACE_CHANGED_EVENT, onWorkspaceChanged)
    }
  }, [])

  useEffect(() => {
    if (!notice) {
      return
    }

    const timer = window.setTimeout(() => setNotice(null), 2400)
    return () => window.clearTimeout(timer)
  }, [notice])

  async function applyWorkspaceData(data: ListWorkspacesData | null) {
    if (!data) {
      return
    }
    setWorkspaceData(data)
    await setActiveConversationsId('')
    await switchWorkspaceConversationsAction(data.currentWorkspacePath)
  }

  async function handleChooseWorkspace() {
    setLoading(true)
    setNotice(null)
    try {
      const data = await workspaceApi.chooseWorkspace()
      await applyWorkspaceData(data)
      if (data) {
        emitWorkspaceChanged()
        setNotice({ type: 'success', message: '工作区已添加' })
        setOpen(false)
      }
    }
    catch (error) {
      setNotice({ type: 'error', message: (error as Error).message })
    }
    finally {
      setLoading(false)
    }
  }

  async function handleOpenWorkspace(item: WorkspaceItem) {
    if (item.path === workspaceData?.currentWorkspacePath) {
      return
    }

    setLoading(true)
    setNotice(null)
    try {
      const data = await workspaceApi.openWorkspace(item.path)
      await applyWorkspaceData(data)
      setOpen(false)
    }
    catch (error) {
      setNotice({ type: 'error', message: (error as Error).message })
    }
    finally {
      setLoading(false)
    }
  }

  function handleRemoveWorkspace(item: WorkspaceItem) {
    setRemoveTarget(item)
  }

  async function confirmRemoveWorkspace() {
    if (!removeTarget) {
      return
    }

    setLoading(true)
    setNotice(null)
    try {
      const data = await workspaceApi.removeWorkspace(removeTarget.path)
      await applyWorkspaceData(data)
      emitWorkspaceChanged()
      setRemoveTarget(null)
    }
    catch (error) {
      setNotice({ type: 'error', message: (error as Error).message })
    }
    finally {
      setLoading(false)
    }
  }

  const content = (
    <div className="w-64">
      <div className="max-h-72 overflow-y-auto">
        {
          workspaceData?.workspaces.length
            ? workspaceData.workspaces.map(item => (
                <WorkspaceRow
                  key={item.path}
                  item={item}
                  active={item.path === workspaceData.currentWorkspacePath}
                  loading={loading}
                  onOpen={handleOpenWorkspace}
                  onRemove={handleRemoveWorkspace}
                />
              ))
            : (
                <div className="px-3 py-8 text-center text-sm text-slate-400">
                  暂无工作区
                </div>
              )
        }
      </div>
      <Button
        className="mt-2 w-full"
        disabled={loading}
        data-workspace-choose
        onClick={handleChooseWorkspace}
      >
        <PlusIcon className="size-4" />
        添加工作区
      </Button>
    </div>
  )

  return (
    <>
      {notice
        ? (
            <div
              className={`
                fixed top-4 right-4 z-100 rounded-md border bg-background px-3 py-2 text-sm
                shadow-md
                ${notice.type === 'error'
              ? 'text-red-500'
              : `
                text-slate-700
                dark:text-slate-200
              `}
              `}
            >
              {notice.message}
            </div>
          )
        : null}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant={compact ? 'ghost' : 'outline'}
            className={`
              max-w-64 justify-start
              ${compactClass}
            `}
          >
            <FolderOpenIcon className="size-4" />
            <span className="min-w-0 flex-1 truncate text-left">
              {currentWorkspace?.displayName || '工作区'}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent side="right" align="start" className="w-72">
          {content}
        </PopoverContent>
      </Popover>

      <AlertDialog
        open={!!removeTarget}
        onOpenChange={nextOpen => !nextOpen && setRemoveTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除工作区</AlertDialogTitle>
            <AlertDialogDescription>
              只会从列表移除，不会删除本地文件。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={loading}
              onClick={(event) => {
                event.preventDefault()
                void confirmRemoveWorkspace()
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

interface WorkspaceRowProps {
  item: WorkspaceItem
  active: boolean
  loading: boolean
  onOpen: (item: WorkspaceItem) => void
  onRemove: (item: WorkspaceItem) => void
}

function WorkspaceRow({ item, active, loading, onOpen, onRemove }: WorkspaceRowProps) {
  return (
    <div className={`
      group flex items-center gap-1 rounded-sm p-1
      hover:bg-black/5
      dark:hover:bg-white/10
    `}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            disabled={loading}
            className="min-w-0 flex-1 justify-start"
            onClick={() => onOpen(item)}
          >
            {active
              ? <CheckIcon className="size-4" />
              : <FolderOpenIcon className="size-4" />}
            <span className="max-w-40 truncate">
              {item.displayName}
            </span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">{item.path}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={item.isDefault || loading}
            className="
              text-red-500
              hover:text-red-600
            "
            onClick={() => onRemove(item)}
          >
            <Trash2Icon className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {item.isDefault ? '默认工作区不可移除' : '移除'}
        </TooltipContent>
      </Tooltip>
    </div>
  )
}
