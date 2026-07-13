import { useEffect, useMemo, useState } from 'react'
import { activateWorkspace, useConversationsStore } from '@/store/conversation'
import { useMessagesStore } from '@/store/messages'
import { useWorkspaceStore } from '@/store/workspace'

export interface SenderWorkspaceController {
  currentPath: string
  displayName: string
  workspaces: Array<{ path: string, displayName: string }>
  canSelect: boolean
  loading: boolean
  pickerOpen: boolean
  error: string
  setPickerOpen: (open: boolean) => void
  switchWorkspace: (path: string) => Promise<void>
}

export function useSenderWorkspace(): SenderWorkspaceController {
  const [loading, setLoading] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [error, setError] = useState('')

  const workspaceData = useWorkspaceStore(state => state.workspaceData)
  const currentPath = useWorkspaceStore(state => state.currentWorkspacePath)
  const refreshWorkspace = useWorkspaceStore(state => state.refresh)
  const openWorkspace = useWorkspaceStore(state => state.openWorkspace)
  const activeConversationId = useMessagesStore(state => state.activeConversationsId)
  const hasMessage = useMessagesStore(state => !!state.messages.length)
  const isRunning = useConversationsStore(
    state => state.conversationStates[state.activeConversationsId] === 'running',
  )

  useEffect(() => {
    void refreshWorkspace()
  }, [refreshWorkspace])

  const workspaces = useMemo(
    () => (workspaceData?.workspaces || []).filter(item => isAbsoluteWorkspacePath(item.path)),
    [workspaceData],
  )
  const canSelect = !activeConversationId && !hasMessage && !isRunning && workspaces.length > 0
  const currentWorkspace = useMemo(
    () => workspaceData?.workspaces.find(item => item.path === currentPath),
    [workspaceData, currentPath],
  )

  async function switchWorkspace(nextPath: string) {
    if (!canSelect || !workspaceData || nextPath === currentPath || !isAbsoluteWorkspacePath(nextPath)) {
      return
    }

    setLoading(true)
    setError('')
    try {
      await openWorkspace(nextPath)
      setPickerOpen(false)
      await activateWorkspace(nextPath)
    }
    catch (cause) {
      setError((cause as Error).message)
    }
    finally {
      setLoading(false)
    }
  }

  return {
    currentPath,
    displayName: currentWorkspace?.displayName || '未选择工作区',
    workspaces,
    canSelect,
    loading,
    pickerOpen,
    error,
    setPickerOpen,
    switchWorkspace,
  }
}

function isAbsoluteWorkspacePath(workspacePath: string): boolean {
  return workspacePath.startsWith('/')
    || /^[a-z]:[\\/]/i.test(workspacePath)
    || workspacePath.startsWith('\\\\')
}
