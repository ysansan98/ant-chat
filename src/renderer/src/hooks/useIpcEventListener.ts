import type { NotificationOption } from '@ant-chat/shared'
import { App } from 'antd'
import { useEffect } from 'react'
import { onAgentApprovalRequired, onAgentProgressUpdated, onAgentStateUpdated } from '@/store/agent'
import { addStreamingConversationId, removeStreamingConversationId } from '@/store/conversation'
import { onMcpServerStatusChanged } from '@/store/mcpConfigs/action'
import { updateMessageActionV2 } from '@/store/messages'
import { ipcRenderer } from '@/utils/ipc-bus'

export function useIpcEventListener() {
  const { notification } = App.useApp()

  useEffect(() => {
    const handle = (_: Electron.IpcRendererEvent, { type, message, description }: NotificationOption) => {
      const func = notification[type]
      func({ title: message, description })
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
    ipcRenderer.on('agent:progress-updated', (_, payload) => {
      onAgentProgressUpdated(payload.taskId, payload.progress)
    })
    ipcRenderer.on('agent:approval-required', (_, payload) => {
      onAgentApprovalRequired(payload.taskId, payload.pendingAction)
    })

    return () => {
      ipcRenderer.removeAllListeners('common:Notification')
      ipcRenderer.removeAllListeners('mcp:McpServerStatusChanged')
      ipcRenderer.removeAllListeners('message:updated')
      ipcRenderer.removeAllListeners('agent:state-updated')
      ipcRenderer.removeAllListeners('agent:progress-updated')
      ipcRenderer.removeAllListeners('agent:approval-required')
    }
  }, [notification])
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
