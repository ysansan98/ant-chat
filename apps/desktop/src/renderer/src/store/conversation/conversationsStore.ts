import type { StoreState, WorkspaceConversationsState } from './initialState'

import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import {
  createInitialState,
  createWorkspaceConversationsState,
  initialState,
} from './initialState'

interface StoreActions {
  reset: () => void
  setActiveConversationsId: (id: string) => void
  switchWorkspace: (workspacePath: string) => void
  saveCurrentWorkspaceSlice: () => void
}
export type ConversationsStore = StoreState & StoreActions

function getWorkspaceSlice(state: StoreState, workspacePath: string): WorkspaceConversationsState {
  return state.workspaceConversations[workspacePath] || createWorkspaceConversationsState()
}

// 创建基础 store
export const useConversationsStore = create<ConversationsStore>()(
  devtools(
    (set, get) => ({
      ...initialState,
      reset: () => {
        set((state) => {
          const nextState = createInitialState()
          nextState.pageSize = state.pageSize
          nextState.currentWorkspacePath = state.currentWorkspacePath

          if (state.currentWorkspacePath) {
            const currentSlice = getWorkspaceSlice(state, state.currentWorkspacePath)
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
              [state.currentWorkspacePath]: nextSlice,
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
        if (!state.currentWorkspacePath) {
          return
        }

        set({
          workspaceConversations: {
            ...state.workspaceConversations,
            [state.currentWorkspacePath]: {
              conversations: state.conversations,
              pageIndex: state.pageIndex,
              conversationsTotal: state.conversationsTotal,
              loadVersion: state.loadVersion,
              loaded: true,
            },
          },
        })
      },
      switchWorkspace: (workspacePath: string) => {
        set((state) => {
          if (workspacePath === state.currentWorkspacePath) {
            return state
          }

          const nextWorkspaceConversations = { ...state.workspaceConversations }

          if (state.currentWorkspacePath) {
            nextWorkspaceConversations[state.currentWorkspacePath] = {
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
            currentWorkspacePath: workspacePath,
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
