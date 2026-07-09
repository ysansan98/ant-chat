import type { AgentExecutionPhase, AgentPendingAction, AgentTaskSnapshot, SecretRequest } from '@ant-chat/shared'
import { create } from 'zustand'
import { isTaskActive } from './predicates'

/**
 * 对话运行时投影的状态载体。
 *
 * 这里集中持有「任务快照 / 每轮执行阶段 / 待审批动作 / 密钥请求」四类运行时数据，
 * 配合 {@link './actions.ts'} 的事件对账，构成一个 deep module：
 * 对外只暴露订阅与少量读取方法，状态规则（活跃判定、阶段增删）只在内部出现一次。
 */
interface AgentRuntimeState {
  tasks: Record<string, AgentTaskSnapshot>
  executionPhaseByTurn: Record<string, AgentExecutionPhase>
  pendingByTask: Record<string, AgentPendingAction>
  secretRequests: Record<string, SecretRequest>
  setTask: (task: AgentTaskSnapshot) => void
  setPending: (taskId: string, pending?: AgentPendingAction) => void
  setSecretRequest: (request: SecretRequest) => void
  clearSecretRequest: (requestId: string) => void
  getActiveTaskByConversation: (conversationId: string) => AgentTaskSnapshot | null
}

export const useAgentRuntimeStore = create<AgentRuntimeState>((set, get) => ({
  tasks: {},
  executionPhaseByTurn: {},
  pendingByTask: {},
  secretRequests: {},
  setTask: task => set((state) => {
    const executionPhaseByTurn = { ...state.executionPhaseByTurn }
    // 活跃任务记录当前执行阶段，终态任务清理对应轮次的阶段标记
    if (isTaskActive(task)) {
      executionPhaseByTurn[task.userMessageId] = task.executionPhase ?? 'waiting_model'
    }
    else {
      delete executionPhaseByTurn[task.userMessageId]
    }
    return {
      tasks: { ...state.tasks, [task.taskId]: { ...task } },
      executionPhaseByTurn,
    }
  }),
  setPending: (taskId, pending) => set((state) => {
    const next = { ...state.pendingByTask }
    if (pending)
      next[taskId] = pending
    else
      delete next[taskId]
    return { pendingByTask: next }
  }),
  setSecretRequest: request => set(state => ({ secretRequests: { ...state.secretRequests, [request.requestId]: request } })),
  clearSecretRequest: requestId => set((state) => {
    const next = { ...state.secretRequests }
    delete next[requestId]
    return { secretRequests: next }
  }),
  getActiveTaskByConversation: (conversationId) => {
    const task = Object.values(get().tasks).find(item => item.conversationId === conversationId && isTaskActive(item))
    return task || null
  },
}))
