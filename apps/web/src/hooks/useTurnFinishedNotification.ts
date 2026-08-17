import { useEffect } from 'react'
import { useNavigate } from 'react-router'
import { getAppEventSubscriptions } from '@/api/transports/appEventSubscriptions'
import { useConversationsStore } from '@/store/conversation'
import { activatePersistedConversationSession } from '@/store/workspaceSession'
import { ipc, isElectronRuntime } from '@/utils/ipc-bus'

/**
 * 系统通知：应用失焦时 turn 执行完成，通过系统级 Notification 提醒，
 * 点击通知跳转到对应会话页。Web 与 Electron 渲染层共用同一套逻辑
 * （Electron 渲染进程的 Notification 同样走系统原生通知）。
 */
export function useTurnFinishedNotification() {
  const navigate = useNavigate()

  // Web 端 Notification 权限必须由用户手势触发申请；Electron 默认已授权。
  // 首次用户交互时顺带申请一次，避免 turn 完成时突然弹权限框。
  useEffect(() => {
    if (typeof window.Notification === 'undefined')
      return

    const requestPermissionOnce = () => {
      if (window.Notification.permission === 'default')
        void window.Notification.requestPermission()
    }
    window.addEventListener('pointerdown', requestPermissionOnce, { once: true })
    window.addEventListener('keydown', requestPermissionOnce, { once: true })
    return () => {
      window.removeEventListener('pointerdown', requestPermissionOnce)
      window.removeEventListener('keydown', requestPermissionOnce)
    }
  }, [])

  useEffect(() => {
    if (typeof window.Notification === 'undefined')
      return

    const subscriptions = getAppEventSubscriptions()
    return subscriptions.subscribe('agent:turn-finished', (payload) => {
      // 用户主动取消的 turn 不打扰
      if (payload.status === 'cancel')
        return
      // 应用持有焦点时不发系统通知（在应用内正常可见）
      if (document.hasFocus())
        return

      const title = useConversationsStore.getState().conversations.find(
        conversation => conversation.id === payload.conversationId,
      )?.title
      void showTurnFinishedNotification({
        conversationId: payload.conversationId,
        status: payload.status,
        conversationTitle: title,
        navigate,
      })
    })
  }, [navigate])
}

interface ShowTurnFinishedNotificationOptions {
  conversationId: string
  status: 'success' | 'error'
  conversationTitle?: string
  navigate: ReturnType<typeof useNavigate>
}

async function showTurnFinishedNotification(options: ShowTurnFinishedNotificationOptions): Promise<void> {
  const { conversationId, status, conversationTitle, navigate } = options

  let permission = window.Notification.permission
  if (permission === 'default')
    permission = await window.Notification.requestPermission()
  if (permission !== 'granted')
    return

  const quote = conversationTitle ? `「${conversationTitle}」` : ''
  const isSuccess = status === 'success'
  const notification = new window.Notification(
    isSuccess ? '任务完成' : '任务失败',
    {
      body: isSuccess
        ? `会话${quote}的回复已生成，点击查看`
        : `会话${quote}执行出错，点击查看`,
      // 同一会话的完成通知互相替换，避免通知中心堆积
      tag: `ant-chat:turn-finished:${conversationId}`,
    },
  )

  notification.onclick = () => {
    notification.close()
    // Electron：窗口可能最小化/隐藏，需要主进程恢复并聚焦
    if (isElectronRuntime()) {
      void ipc.app.focusWindow().catch(() => {})
    }
    else {
      // Web：聚焦当前标签页
      window.focus()
    }
    navigate('/chat')
    void activatePersistedConversationSession(conversationId).catch((error) => {
      console.warn('系统通知跳转会话失败', error)
    })
  }
}
