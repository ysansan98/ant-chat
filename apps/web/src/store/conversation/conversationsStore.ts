import type { StoreState, WorkspaceConversationsState } from './initialState'

import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { useWorkspaceStore } from '@/store/workspace'
import {
  createInitialState,
  createWorkspaceConversationsState,
  initialState,
} from './initialState'

interface StoreActions {
  reset: () => void
  setActiveConversationsId: (id: string) => void
  switchWorkspaceSlice: (workspacePath: string) => void
  saveCurrentWorkspaceSlice: () => void
}
export type ConversationsStore = StoreState & StoreActions

/**
 * 跨 store 读取当前工作区路径(SSOT 在 workspaceStore)。
 * conversationsStore 不再持有 currentWorkspacePath,需要时统一从此取。
 */
function getCurrentWorkspacePath(): string {
  return useWorkspaceStore.getState().currentWorkspacePath ?? ''
}

function getWorkspaceSlice(state: StoreState, workspacePath: string): WorkspaceConversationsState {
  return state.workspaceConversations[workspacePath] || createWorkspaceConversationsState()
}

// 创建基础 store
export const useConversationsStore = create<ConversationsStore>()(
  devtools(
    (set, get) => ({
      ...initialState,
      reset: () => {
        const currentPath = getCurrentWorkspacePath()
        set((state) => {
          const nextState = createInitialState()
          nextState.pageSize = state.pageSize

          if (currentPath) {
            const currentSlice = getWorkspaceSlice(state, currentPath)
            const nextSlice: WorkspaceConversationsState = {
              ...currentSlice,
              conversations: [],
              pageIndex: 0,
              conversationsTotal: 0,
              loadVersion: currentSlice.loadVersion + 1,
              loaded: true,
            }
            nextState.workspaceConversations = {
              ...state.workspaceConversations,
              [currentPath]: nextSlice,
            }
            nextState.conversations = nextSlice.conversations
            nextState.pageIndex = nextSlice.pageIndex
            nextState.conversationsTotal = nextSlice.conversationsTotal
            nextState.loadVersion = nextSlice.loadVersion
          }

          return nextState
        })
      },
      setActiveConversationsId: (id: string) => {
        set({ activeConversationsId: id })
      },
      saveCurrentWorkspaceSlice: () => {
        const state = get()
        const currentPath = getCurrentWorkspacePath()
        if (!currentPath) {
          return
        }

        set({
          workspaceConversations: {
            ...state.workspaceConversations,
            [currentPath]: {
              conversations: state.conversations,
              pageIndex: state.pageIndex,
              conversationsTotal: state.conversationsTotal,
              loadVersion: state.loadVersion,
              loaded: true,
            },
          },
        })
      },
      switchWorkspaceSlice: (workspacePath: string) => {
        const currentPath = getCurrentWorkspacePath()
        if (workspacePath === currentPath) {
          return
        }

        set((state) => {
          const nextWorkspaceConversations = { ...state.workspaceConversations }

          if (currentPath) {
            nextWorkspaceConversations[currentPath] = {
              conversations: state.conversations,
              pageIndex: state.pageIndex,
              conversationsTotal: state.conversationsTotal,
              loadVersion: state.loadVersion,
              loaded: true,
            }
          }

          const nextSlice = nextWorkspaceConversations[workspacePath] || createWorkspaceConversationsState()

          return {
            ...state,
            workspaceConversations: nextWorkspaceConversations,
            conversations: nextSlice.conversations,
            pageIndex: nextSlice.pageIndex,
            conversationsTotal: nextSlice.conversationsTotal,
            loadVersion: nextSlice.loadVersion,
            activeConversationsId: '',
            streamingConversationIds: new Set<string>(),
            abortCallbacks: [],
          }
        })
      },
    }),
    {
      enabled: import.meta.env.MODE === 'development',
    },
  ),
)
