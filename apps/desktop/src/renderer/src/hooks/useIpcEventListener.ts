import type { NotificationOption } from '@ant-chat/shared'
import { useEffect } from 'react'
import { toast } from 'sonner'
import { onAgentApprovalRequired, onAgentStateUpdated } from '@/store/agent'
import { addStreamingConversationId, removeStreamingConversationId } from '@/store/conversation'
import { onMcpServerStatusChanged } from '@/store/mcpConfigs/action'
import { updateMessageActionV2 } from '@/store/messages'
import { ipcRenderer } from '@/utils/ipc-bus'

export function useIpcEventListener() {
  useEffect(() => {
    const handle = (_: Electron.IpcRendererEvent, notif: NotificationOption) => {
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

    ipcRenderer.on('common:Notification', handle)
    ipcRenderer.on('mcp:McpServerStatusChanged', onMcpServerStatusChanged)
    ipcRenderer.on('message:updated', (_, msg) => {
      console.log('message:updated => ', msg)

      handleStreamingConversationStatus(msg)
      updateMessageActionV2(msg)
    })

    ipcRenderer.on('agent:state-updated', (_, payload) => {
      onAgentStateUpdated(payload.task)
    })
    ipcRenderer.on('agent:approval-required', (_, payload) => {
      onAgentApprovalRequired(payload.taskId, payload.pendingAction)
    })

    return () => {
      ipcRenderer.removeAllListeners('common:Notification')
      ipcRenderer.removeAllListeners('mcp:McpServerStatusChanged')
      ipcRenderer.removeAllListeners('message:updated')
      ipcRenderer.removeAllListeners('agent:state-updated')
      ipcRenderer.removeAllListeners('agent:approval-required')
    }
  }, [])
}

// 处理对话流式状态的辅助函数
function handleStreamingConversationStatus(msg: { status: string, convId: string }) {
  if (['typing', 'loading'].includes(msg.status)) {
    addStreamingConversationId(msg.convId)
  }
  else {
    removeStreamingConversationId(msg.convId)
  }
}
