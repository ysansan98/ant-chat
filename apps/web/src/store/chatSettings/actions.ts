import type { AgentMode } from '@ant-chat/shared'
import { toast } from 'sonner'
import agentApi from '@/api/agentApi'
import { getActiveTask } from '@/store/agentRuntime'
import { useMessagesStore } from '@/store/messages'
import { useChatSttingsStore } from './store'

export function setAgentMode(value: AgentMode) {
  useChatSttingsStore.setState({ agentMode: value })

  // 运行中任务即时生效：切换前已产生但未开始执行的工具调用，
  // 在授权边界读到新 mode；已执行的不追溯，已挂起审批不被自动放行。
  const conversationId = useMessagesStore.getState().activeConversationsId
  const activeTask = conversationId ? getActiveTask(conversationId) : null
  if (activeTask) {
    void agentApi.updateTaskMode(activeTask.taskId, value).then((updated) => {
      if (updated) {
        toast.info('已切换，后续工具调用按新权限生效')
      }
      else {
        toast.warning('权限切换未应用到当前 turn，下轮生效')
      }
    }).catch((error) => {
      // 失败不阻塞本地切换；当前 turn 可能仍按旧模式授权，下轮使用本地新模式
      console.error('updateTaskMode failed:', error)
      toast.warning('权限切换未应用到当前 turn，下轮生效')
    })
  }
}
