import type { NotificationOption } from '@ant-chat/shared'
import { useEffect } from 'react'
import { toast } from 'sonner'
import { getAppEventBus } from '@/api/transports/appEventBus'
import { onAgentApprovalRequired, onAgentSecretRequested, onAgentStateUpdated } from '@/store/agent'
import { touchConversationUpdatedAt, upsertConversationAction } from '@/store/conversation'
import { refreshGeneralSettings } from '@/store/generalSettings/actions'
import { onMcpServerStatusChanged } from '@/store/mcpConfigs/action'
import { updateMessageActionV2 } from '@/store/messages'
import { drainPendingMessages } from '@/store/pendingMessages'
import { useWorkspaceStore } from '@/store/workspace'

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
    eventBus.on('mcp:status-changed', (_, payload) => {
      onMcpServerStatusChanged(payload.serverName, payload.status)
    })
    eventBus.on('conversation:updated', (_, payload) => {
      upsertConversationAction(payload.conversation)
    })
    eventBus.on('message:updated', (_, payload) => {
      touchConversationUpdatedAt(payload.message.convId, Date.now())
      updateMessageActionV2(payload.message)
    })

    eventBus.on('agent:task-updated', (_, payload) => {
      onAgentStateUpdated(payload.task)
      // 任务完成时排空待处理消息队列
      // turn 完成与 task-updated 在时序上紧邻（turn-finished 总在 task-updated 之前），
      // 此处统一处理，无需额外监听 agent:turn-finished
      if (!['running', 'awaiting_approval'].includes(payload.task.status)) {
        if (payload.task.status !== 'cancelled')
          void drainPendingMessages(payload.task.conversationId)
      }
    })
    eventBus.on('agent:approval-required', (_, payload) => {
      onAgentApprovalRequired(payload.taskId, payload.pendingAction)
    })
    eventBus.on('agent:secret-requested', (_, payload) => {
      onAgentSecretRequested(payload.request)
    })
    eventBus.on('settings:updated', () => {
      void refreshGeneralSettings()
    })
    eventBus.on('workspace:changed', () => {
      void useWorkspaceStore.getState().refresh()
    })

    return () => {
      eventBus.removeAllListeners('common:Notification')
      eventBus.removeAllListeners('mcp:status-changed')
      eventBus.removeAllListeners('conversation:updated')
      eventBus.removeAllListeners('message:updated')
      eventBus.removeAllListeners('agent:task-updated')
      eventBus.removeAllListeners('agent:approval-required')
      eventBus.removeAllListeners('agent:secret-requested')
      eventBus.removeAllListeners('settings:updated')
      eventBus.removeAllListeners('workspace:changed')
    }
  }, [])
}
