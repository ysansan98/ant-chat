import type { AgentPendingAction, AgentTaskSnapshot, IMessage, NotificationOption } from '@ant-chat/shared'
import { useEffect } from 'react'
import { toast } from 'sonner'
import { getAppEventBus } from '@/api/transports/appEventBus'
import { onAgentApprovalRequired, onAgentStateUpdated } from '@/store/agent'
import { addStreamingConversationId, removeStreamingConversationId } from '@/store/conversation'
import { onMcpServerStatusChanged } from '@/store/mcpConfigs/action'
import { updateMessageActionV2 } from '@/store/messages'

export function useAppEventListener() {
  useEffect(() => {
    const eventBus = getAppEventBus()
    const handle = (_: unknown, notif: NotificationOption) => {
      const { message } = notif
      const desc = notif.description
      const text = `${message}${desc ? `: ${desc}` : ''}`
      switch (notif.type) {
        case 'success':
          toast.success(text)
          break
        case 'error':
          toast.error(text)
          break
        case 'warning':
          toast.warning(text)
          break
        default:
          toast.info(text)
      }
    }

    eventBus.on('common:Notification', handle)
    eventBus.on('mcp:McpServerStatusChanged', onMcpServerStatusChanged as (event: unknown, name: string, status: 'disconnected' | 'connected') => void)
    eventBus.on('message:updated', (_, msg) => {
      console.log('message:updated => ', msg)

      handleStreamingConversationStatus(msg)
      updateMessageActionV2(msg)
    })

    eventBus.on('agent:state-updated', (_, payload: { task: AgentTaskSnapshot }) => {
      onAgentStateUpdated(payload.task)
    })
    eventBus.on('agent:approval-required', (_, payload: { taskId: string, conversationId: string, pendingAction: AgentPendingAction }) => {
      onAgentApprovalRequired(payload.taskId, payload.pendingAction)
    })

    return () => {
      eventBus.removeAllListeners('common:Notification')
      eventBus.removeAllListeners('mcp:McpServerStatusChanged')
      eventBus.removeAllListeners('message:updated')
      eventBus.removeAllListeners('agent:state-updated')
      eventBus.removeAllListeners('agent:approval-required')
    }
  }, [])
}

function handleStreamingConversationStatus(msg: Pick<IMessage, 'status' | 'convId'>) {
  if (['typing', 'loading'].includes(msg.status)) {
    addStreamingConversationId(msg.convId)
  }
  else {
    removeStreamingConversationId(msg.convId)
  }
}
