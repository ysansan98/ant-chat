import type { IConversations } from '@ant-chat/shared'
import type { ConversationsStoreState } from './initialState'

import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { createInitialState, initialState } from './initialState'

interface StoreActions {
  reset: () => void
}
export type ConversationsStore = ConversationsStoreState & StoreActions

// ---- 派生 selector ----

export function selectWorkspaceConversations(
  state: ConversationsStoreState,
  workspacePath: string,
): IConversations[] {
  return state.conversations.filter(conversation => conversation.workspacePath === workspacePath)
}

export function selectWorkspaceTotal(state: ConversationsStoreState, workspacePath: string): number {
  return state.conversationsTotal[workspacePath] ?? 0
}

// ---- 工作区首屏加载标记（模块级，不参与响应式更新）----

const loadedWorkspaces = new Set<string>()

export function isWorkspaceLoaded(workspacePath: string): boolean {
  return loadedWorkspaces.has(workspacePath)
}

export function markWorkspaceLoaded(workspacePath: string): void {
  loadedWorkspaces.add(workspacePath)
}

export function clearLoadedWorkspaces(): void {
  loadedWorkspaces.clear()
}

// 创建基础 store
export const useConversationsStore = create<ConversationsStore>()(
  devtools(
    set => ({
      ...initialState,
      reset: () => {
        clearLoadedWorkspaces()
        set(createInitialState())
      },
    }),
    {
      enabled: import.meta.env.MODE === 'development',
    },
  ),
)
