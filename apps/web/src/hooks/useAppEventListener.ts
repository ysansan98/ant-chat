import type { NotificationOption } from '@ant-chat/shared'
import { useEffect } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { getAppEventSubscriptions } from '@/api/transports/appEventSubscriptions'
import { emitAutomationChanged, emitAutomationRunChanged } from '@/constants/automationEvents'
import { emitProviderChanged } from '@/constants/providerEvents'
import { applyApprovalRequired, applySecretRequest, applyTaskUpdate, isTaskActive } from '@/store/agentRuntime'
import { touchConversationUpdatedAt, upsertConversationAction } from '@/store/conversation'
import { refreshGeneralSettings } from '@/store/generalSettings/actions'
import { onMcpServerStatusChanged, refreshMcpConfigs } from '@/store/mcpConfigs/action'
import { updateMessageActionV2 } from '@/store/messages'
import { drainPendingMessages } from '@/store/pendingMessages'
import { useWorkspaceStore } from '@/store/workspace'

/**
 * 订阅渲染进程收到的全部应用事件，统一分发到 store 更新与路由导航。
 * 依赖 Router 上下文（app:navigate 需要 useNavigate），仅应在路由壳组件内调用。
 */
export function useAppEventListener() {
  const navigate = useNavigate()
  useEffect(() => {
    const eventSubscriptions = getAppEventSubscriptions()
    const handle = (notif: NotificationOption) => {
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

    const unsubscribes = [
      eventSubscriptions.subscribe('common:Notification', handle),
      eventSubscriptions.subscribe('mcp:status-changed', (payload) => {
        onMcpServerStatusChanged(payload.serverName, payload.status)
      }),
      eventSubscriptions.subscribe('conversation:updated', (payload) => {
        upsertConversationAction(payload.conversation)
      }),
      eventSubscriptions.subscribe('message:updated', (payload) => {
        touchConversationUpdatedAt(payload.message.convId, Date.now())
        updateMessageActionV2(payload.message)
      }),

      eventSubscriptions.subscribe('agent:task-updated', (payload) => {
        applyTaskUpdate(payload.task)
        // 任务完成时排空待处理消息队列
        // turn 完成与 task-updated 在时序上紧邻（turn-finished 总在 task-updated 之前），
        // 此处统一处理，无需额外监听 agent:turn-finished
        if (!isTaskActive(payload.task)) {
          if (payload.task.status !== 'cancelled')
            void drainPendingMessages(payload.task.conversationId)
        }
      }),
      eventSubscriptions.subscribe('agent:approval-required', (payload) => {
        applyApprovalRequired(payload.taskId, payload.pendingAction)
      }),
      eventSubscriptions.subscribe('agent:secret-requested', (payload) => {
        applySecretRequest(payload.request)
      }),
      eventSubscriptions.subscribe('settings:updated', () => {
        void refreshGeneralSettings()
      }),
      eventSubscriptions.subscribe('mcp:changed', () => {
        void refreshMcpConfigs()
      }),
      eventSubscriptions.subscribe('provider:changed', () => {
        emitProviderChanged()
      }),
      eventSubscriptions.subscribe('automation:changed', () => {
        emitAutomationChanged()
      }),
      eventSubscriptions.subscribe('automation:run-changed', () => {
        emitAutomationRunChanged()
      }),
      eventSubscriptions.subscribe('workspace:changed', () => {
        void useWorkspaceStore.getState().refresh()
      }),
      // macOS 应用菜单「设置」(Cmd+,) 由主进程发 app:navigate，在窗口内路由跳转
      eventSubscriptions.subscribe('app:navigate', (path) => {
        navigate(path)
      }),
    ]

    return () => {
      for (const unsubscribe of unsubscribes)
        unsubscribe()
    }
  }, [navigate])
}
