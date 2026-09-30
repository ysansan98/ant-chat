import type { ConversationsId } from '@ant-chat/shared'
import { produce } from 'immer'
import chatApi from '@/api/chatApi'
import { syncConversationRuntime } from '@/store/agentRuntime'
import { useMessagesStore } from '@/store/messages'
import { syncPendingMessages } from '@/store/pendingMessages'

let loadVersion = 0

/** 清空 conversation、messages 两个投影，并使在途加载结果失效。 */
export function clearConversationSession(): void {
  ++loadVersion

  useMessagesStore.setState(state => produce(state, (draft) => {
    draft.activeConversationsId = '' as ConversationsId
    draft.messages = []
  }))
}

/**
 * 在持久化消息与 runtime 对账完成后一次性提交会话投影。
 * 版本号防止较慢的旧请求覆盖用户刚刚选择的新会话。
 */
export async function activateConversationSession(id: ConversationsId | ''): Promise<void> {
  if (!id) {
    clearConversationSession()
    return
  }

  const version = ++loadVersion
  const [messagesResult, runtimeResult, pendingResult] = await Promise.allSettled([
    chatApi.getMessagesByConvId(id),
    syncConversationRuntime(id),
    syncPendingMessages(id),
  ])

  if (version !== loadVersion)
    return
  if (messagesResult.status === 'rejected')
    throw messagesResult.reason
  if (runtimeResult.status === 'rejected')
    throw runtimeResult.reason
  // 队列投影失败不阻塞会话打开，等待后续事件对账
  if (pendingResult.status === 'rejected')
    console.warn('同步待处理消息队列失败', pendingResult.reason)

  useMessagesStore.setState(state => produce(state, (draft) => {
    const persistedMessageIds = new Set(messagesResult.value.map(message => message.id))
    const pendingSteering = (draft.pendingSteeringByConversation[id] ?? [])
      .filter(message => !persistedMessageIds.has(message.id))
    if (pendingSteering.length > 0)
      draft.pendingSteeringByConversation[id] = pendingSteering
    else
      delete draft.pendingSteeringByConversation[id]
    draft.activeConversationsId = id
    draft.messages.splice(0, draft.messages.length, ...messagesResult.value, ...pendingSteering)
  }))
}

/**
 * Turn 已由后端接受但完整对账失败时，仍将前端切到已提交的新会话。
 * 这样调用方不会把“投影失败”误报成“发送失败”并诱导重复提交。
 */
export function commitConversationSelection(id: ConversationsId): void {
  ++loadVersion
  useMessagesStore.setState(state => produce(state, (draft) => {
    draft.activeConversationsId = id
    draft.messages = []
  }))
}
