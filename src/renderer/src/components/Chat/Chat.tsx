import type { AgentMode, ChatFeatures, IAttachment, IImage } from '@ant-chat/shared'
import { App, Skeleton } from 'antd'
import { lazy, Suspense } from 'react'
import { AgentApprovalCard, AgentProgressList } from '@/components/Agent'
import { DEFAULT_TITLE } from '@/constants'
import { useChatSettingsContext } from '@/contexts/chatSettings'
import { approveAgentAction, rejectAgentAction, startAgentTurn, useAgentStore } from '@/store/agent'
import {
  initConversationsTitle,
  upsertConversationAction,
  useConversationsStore,
} from '@/store/conversation'
import {
  abortActiveRequest,
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

    const isNewConversation = !activeConversationsId
    const result = await startAgentTurn({
      conversationId: activeConversationsId || undefined,
      prompt: message,
      images,
      attachments,
      mode: agentMode,
      workspacePath: currentWorkspacePath || undefined,
      chatSettings: {
        ...settings,
        features,
      },
    })
    upsertConversationAction(result.conversation)
    await setActiveConversationsId(result.conversationId)

    // 初始化会话标题
    if (currentConversations?.title === DEFAULT_TITLE || isNewConversation) {
      // 1s后再次初始化会话标题, 避免请求频繁导致的标题未更新
      setTimeout(() => {
        initConversationsTitle(result.conversationId)
      }, 1000)
    }
  }

  return (
    <div
      key={currentConversations?.id}
      className="relative mx-auto grid h-(--mainHeight) w-full grid-rows-[1fr_max-content]"
    >

      {
        messages.length > 0
          ? (
              <Suspense fallback={<BubbleSkeleton />}>
                <BubbleList
                  messages={messages}
                  conversationsId={activeConversationsId}
                  isAgentRunning={Boolean(agentTask)}
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
  )
}

function BubbleSkeleton() {
  return (
    <div className="mx-auto flex w-(--chat-width) flex-col gap-3">
      <Skeleton paragraph={{ rows: 4 }} active />
      <Skeleton paragraph={{ rows: 4 }} active />
      <Skeleton paragraph={{ rows: 4 }} active />
    </div>
  )
}
