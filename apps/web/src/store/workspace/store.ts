import type { ListWorkspacesData, WorkspaceItem } from '@ant-chat/shared'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import workspaceApi from '@/api/workspaceApi'
import { WORKSPACE_CHANGED_EVENT } from '@/constants/workspaceEvents'

interface WorkspaceStoreState {
  /** 当前工作区路径(SSOT):前端派生 + 工作区操作显式设置。后端不再回传。 */
  currentWorkspacePath: string
  workspaceData: ListWorkspacesData | null
  loading: boolean
}

interface WorkspaceStoreActions {
  refresh: () => Promise<void>
  addWorkspace: (path: string) => Promise<ListWorkspacesData>
  removeWorkspace: (path: string) => Promise<ListWorkspacesData>
  reorderWorkspaces: (paths: string[]) => Promise<ListWorkspacesData>
}

export type WorkspaceStore = WorkspaceStoreState & WorkspaceStoreActions

/**
 * 从 workspaces 列表中取 lastOpenedAt 最大者为当前工作区。
 * 列表为空时返回空串(由后端 ensureInitialized 保证默认工作区始终在列表,实际不会为空)。
 */
function pickLatestWorkspace(workspaces: WorkspaceItem[]): string {
  if (workspaces.length === 0) {
    return ''
  }
  return workspaces.reduce((latest, item) => {
    const ts = item.lastOpenedAt ?? 0
    const latestTs = latest.lastOpenedAt ?? 0
    return ts > latestTs ? item : latest
  }).path
}

export const useWorkspaceStore = create<WorkspaceStore>()(
  devtools(
    set => ({
      currentWorkspacePath: '',
      workspaceData: null,
      loading: false,

      refresh: async () => {
        const data = await workspaceApi.listWorkspaces()
        set((state) => {
          const workspaces = data.workspaces
          // 当前路径为空或不在列表中时,按 lastOpenedAt 派生;否则保持
          const stillValid = state.currentWorkspacePath
            && workspaces.some(item => item.path === state.currentWorkspacePath)
          const currentWorkspacePath = stillValid
            ? state.currentWorkspacePath
            : pickLatestWorkspace(workspaces)
          return { workspaceData: data, currentWorkspacePath }
        })
      },

      addWorkspace: async (path: string) => {
        const data = await workspaceApi.addWorkspace(path)
        set({ workspaceData: data, currentWorkspacePath: path })
        return data
      },

      removeWorkspace: async (path: string) => {
        const data = await workspaceApi.removeWorkspace(path)
        set((state) => {
          // 删的是当前工作区时,回退到 lastOpenedAt 最大者;否则保持
          const isCurrent = path === state.currentWorkspacePath
          const currentWorkspacePath = isCurrent
            ? pickLatestWorkspace(data.workspaces)
            : state.currentWorkspacePath
          return { workspaceData: data, currentWorkspacePath }
        })
        return data
      },

      reorderWorkspaces: async (paths: string[]) => {
        const data = await workspaceApi.reorderWorkspaces(paths)
        set({ workspaceData: data })
        return data
      },
    }),
    { name: 'workspace-store' },
  ),
)

// 全局监听工作区变更事件,自动刷新(刷新内部按 lastOpenedAt 派生当前路径)
if (typeof window !== 'undefined') {
  window.addEventListener(WORKSPACE_CHANGED_EVENT, () => {
    void useWorkspaceStore.getState().refresh()
  })
}
