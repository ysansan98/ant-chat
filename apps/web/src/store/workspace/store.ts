import type { ListWorkspacesData } from '@ant-chat/shared'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import workspaceApi from '@/api/workspaceApi'
import { WORKSPACE_CHANGED_EVENT } from '@/constants/workspaceEvents'

interface WorkspaceStoreState {
  workspaceData: ListWorkspacesData | null
  loading: boolean
}

interface WorkspaceStoreActions {
  refresh: () => Promise<void>
  openWorkspace: (path: string) => Promise<ListWorkspacesData>
  addWorkspace: (path: string) => Promise<ListWorkspacesData>
  removeWorkspace: (path: string) => Promise<ListWorkspacesData>
}

export type WorkspaceStore = WorkspaceStoreState & WorkspaceStoreActions

export const useWorkspaceStore = create<WorkspaceStore>()(
  devtools(
    set => ({
      workspaceData: null,
      loading: false,

      refresh: async () => {
        const data = await workspaceApi.listWorkspaces()
        set({ workspaceData: data })
      },

      openWorkspace: async (path: string) => {
        const data = await workspaceApi.openWorkspace(path)
        set({ workspaceData: data })
        return data
      },

      addWorkspace: async (path: string) => {
        const data = await workspaceApi.addWorkspace(path)
        set({ workspaceData: data })
        return data
      },

      removeWorkspace: async (path: string) => {
        const data = await workspaceApi.removeWorkspace(path)
        set({ workspaceData: data })
        return data
      },
    }),
    { name: 'workspace-store' },
  ),
)

// 全局监听工作区变更事件，自动刷新
if (typeof window !== 'undefined') {
  window.addEventListener(WORKSPACE_CHANGED_EVENT, () => {
    void useWorkspaceStore.getState().refresh()
  })
}
