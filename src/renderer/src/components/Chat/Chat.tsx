import type { AgentMode, ChatFeatures, ConversationsId, IAttachment, IImage, IMessage } from '@ant-chat/shared'
import { App, Skeleton } from 'antd'
import { lazy, Suspense } from 'react'
import { useShallow } from 'zustand/shallow'
import { createConversations, createUserMessage } from '@/api/dataFactory'
import { AgentApprovalCard, AgentProgressList } from '@/components/Agent'
import { DEFAULT_TITLE } from '@/constants'
import { AudioPlayProvider } from '@/contexts/audioplay'
import { useChatSettingsContext } from '@/contexts/chatSettings'
import { approveAgentAction, rejectAgentAction, startAgentTask, useAgentStore } from '@/store/agent'
import { useChatSttingsStore } from '@/store/chatSettings'
import {
  addConversationsAction,
  initConversationsTitle,
  useConversationsStore,
} from '@/store/conversation'
import {
  abortActiveRequest,
  addMessageAction,
  onRequestAction,
  refreshRequestAction,
  setActiveConversationsId,
  useMessagesStore,
} from '@/store/messages'
import Sender from '../Sender'
import { ModelControlPanel } from '../Sender/PickerModel'

const BubbleList = lazy(() => import('./BubbleList'))

export default function Chat() {
  const messages = useMessagesStore(state => state.messages)
  const activeConversationsId = useMessagesStore(state => state.activeConversationsId)
  const currentConversations = useConversationsStore(state => state.conversations.find(item => item.id === activeConversationsId))
  const currentWorkspacePath = useConversationsStore(state => state.currentWorkspacePath)
  const features = useChatSttingsStore(useShallow(state => ({ onlineSearch: state.onlineSearch, enableMCP: state.enableMCP })))

  const { notification } = App.useApp()
  const { settings, updateSettings } = useChatSettingsContext()
  const agentTask = useAgentStore(state => state.getActiveTaskByConversation(activeConversationsId))
  const agentTaskId = agentTask?.taskId
  const progress = useAgentStore(state => (agentTaskId ? state.progressByTask[agentTaskId] : undefined))
  const pending = useAgentStore(state => (agentTaskId ? state.pendingByTask[agentTaskId] : undefined))

  async function onSubmit(
    message: string,
    images: IImage[],
    attachments: IAttachment[],
    features: ChatFeatures,
    agentMode: AgentMode,
  ) {
    if (!settings.modelId) {
      notification.error({
        title: '请选择模型',
        placement: 'bottomRight',
      })
      return
    }

    let id = activeConversationsId
    let isNewConversation = false
    // 如果当前没有会话，则创建一个
    if (!activeConversationsId) {
      const conversation = await addConversationsAction(createConversations({ settings }))
      id = conversation.id
      isNewConversation = true
    }

    await setActiveConversationsId(id)

    const messageItem: IMessage = createUserMessage({ images, attachments, content: [{ type: 'text', text: message }], convId: id as ConversationsId })
    const persistedMessage = await addMessageAction(messageItem)

    await startAgentTask({
      conversationId: id as string,
      userMessageId: persistedMessage.id,
      prompt: message,
      mode: agentMode,
      workspacePath: currentWorkspacePath || undefined,
      chatSettings: {
        ...settings,
        features,
      },
    })

    // 初始化会话标题
    if (currentConversations?.title === DEFAULT_TITLE || isNewConversation) {
      // 1s后再次初始化会话标题, 避免请求频繁导致的标题未更新
      setTimeout(() => {
        initConversationsTitle(id)
      }, 1000)
    }
  }

  return (
    <AudioPlayProvider>
      <div
        key={currentConversations?.id}
        className="relative mx-auto grid h-(--mainHeight) w-full grid-rows-[1fr_max-content]"
      >
        <div
          className={`
            absolute top-0 left-0 z-10 h-5 w-full bg-linear-to-b from-white to-transparent
            dark:from-black
          `}
        >
        </div>
        {
          messages.length > 0
            ? (
                <Suspense fallback={<BubbleSkeleton />}>
                  <BubbleList
                    messages={messages}
                    conversationsId={activeConversationsId}
                    onRefresh={async (message) => {
                      if (!settings.modelId) {
                        notification.error({ title: '请选择模型' })
                        return
                      }
                      refreshRequestAction(activeConversationsId, message, features, settings)
                    }}
                    onExecuteAllCompleted={
                      () => {
                        if (!settings.modelId) {
                          notification.error({ title: '请选择模型' })
                          return
                        }
                        onRequestAction(activeConversationsId, features, settings)
                      }
                    }
                  />
                </Suspense>
              )
            : null
        }
        <div className="px-2 pb-4">
          <AgentProgressList progress={progress || []} />
          {agentTask && pending
            ? (
                <AgentApprovalCard
                  pending={pending}
                  onApprove={() => void approveAgentAction({ taskId: agentTask.taskId, actionId: pending.actionId })}
                  onReject={() => void rejectAgentAction({ taskId: agentTask.taskId, actionId: pending.actionId, reason: '用户拒绝' })}
                />
              )
            : null}
          <Sender
            actions={(
              <ModelControlPanel
                value={settings.modelId}
                onChange={(modelInfo) => {
                  const { id: modelId, maxTokens, temperature } = modelInfo
                  updateSettings({ modelId, maxTokens, temperature })
                }}
              />
            )}
            onSubmit={onSubmit}
            onCancel={() => {
              void abortActiveRequest(activeConversationsId)
            }}
          />
        </div>
      </div>
    </AudioPlayProvider>
  )
}

function BubbleSkeleton() {
  return (
    <div className="mx-auto flex w-(--chat-width) flex-col gap-3">
      <Skeleton avatar paragraph={{ rows: 4 }} active />
      <Skeleton avatar paragraph={{ rows: 4 }} active />
      <Skeleton avatar paragraph={{ rows: 4 }} active />
    </div>
  )
}
