import type { NotificationOption } from '@ant-chat/shared'
import { App } from 'antd'
import { useEffect } from 'react'
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
    ipcRenderer.on('chat:stream-message', (_, msg) => {
      console.log('chat:stream-message => ', msg)

      handleStreamingConversationStatus(msg)
      updateMessageActionV2(msg)
    })

    return () => {
      ipcRenderer.removeAllListeners('common:Notification')
      ipcRenderer.removeAllListeners('mcp:McpServerStatusChanged')
      ipcRenderer.removeAllListeners('chat:stream-message')
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
