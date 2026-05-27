import type { AgentPendingAction, AgentTaskSnapshot } from '@ant-chat/shared'
import { create } from 'zustand'

interface AgentState {
  tasks: Record<string, AgentTaskSnapshot>
  pendingByTask: Record<string, AgentPendingAction>
  setTask: (task: AgentTaskSnapshot) => void
  setPending: (taskId: string, pending?: AgentPendingAction) => void
  getActiveTaskByConversation: (conversationId: string) => AgentTaskSnapshot | null
}

export const useAgentStore = create<AgentState>((set, get) => ({
  tasks: {},
  pendingByTask: {},
  setTask: task => set(state => ({ tasks: { ...state.tasks, [task.taskId]: task } })),
  setPending: (taskId, pending) => set((state) => {
    const next = { ...state.pendingByTask }
    if (pending)
      next[taskId] = pending
    else delete next[taskId]
    return { pendingByTask: next }
  }),
  getActiveTaskByConversation: (conversationId) => {
    const task = Object.values(get().tasks).find(item => item.conversationId === conversationId && ['running', 'awaiting_approval'].includes(item.status))
    return task || null
  },
}))
