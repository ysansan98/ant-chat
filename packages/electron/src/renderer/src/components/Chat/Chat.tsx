import type { ChatFeatures, ConversationsId, IAttachment, IImage, IMessage } from '@ant-chat/shared'
import { App, Skeleton } from 'antd'
import { lazy, Suspense } from 'react'
import { useShallow } from 'zustand/shallow'
import { createConversations, createUserMessage } from '@/api/dataFactory'
import { DEFAULT_TITLE } from '@/constants'
import { useChatSettingsContext } from '@/contexts/chatSettings'
import { useChatSttingsStore } from '@/store/chatSettings'
import {
  addConversationsAction,
  initConversationsTitle,
  useConversationsStore,
} from '@/store/conversation'
import {
  abortSendChatCompletions,
  addMessageAction,
  onRequestAction,
  refreshRequestAction,
  setActiveConversationsId,
  useMessagesStore,
} from '@/store/messages'
import Loading from '../Loading'
import Sender from '../Sender'
import { ModelControlPanel } from '../Sender/PickerModel'

const BubbleList = lazy(() => import('./BubbleList'))
const RunnerCode = lazy(() => import('../RunnerCode'))

export default function Chat() {
  const messages = useMessagesStore(state => state.messages)
  const activeConversationsId = useMessagesStore(state => state.activeConversationsId)
  const currentConversations = useConversationsStore(state => state.conversations.find(item => item.id === activeConversationsId))
  const features = useChatSttingsStore(useShallow(state => ({ onlineSearch: state.onlineSearch, enableMCP: state.enableMCP })))

  const { notification } = App.useApp()
  const { settings, updateSettings } = useChatSettingsContext()

  async function onSubmit(
    message: string,
    images: IImage[],
    attachments: IAttachment[],
    features: ChatFeatures,
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
    await addMessageAction(messageItem)

    // 发送请求
    await onRequestAction(id, features, settings)

    // 初始化会话标题
    if (currentConversations?.title === DEFAULT_TITLE || isNewConversation) {
      // 1s后再次初始化会话标题, 避免请求频繁导致的标题未更新
      setTimeout(() => {
        initConversationsTitle(id)
      }, 1000)
    }
  }

  return (
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
            abortSendChatCompletions(activeConversationsId)
          }}
        />
      </div>
      <Suspense fallback={<Loading />}>
        <RunnerCode />
      </Suspense>
    </div>
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
