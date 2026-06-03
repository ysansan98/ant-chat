import type { AgentMode, ChatFeatures, IMessageContent } from '@ant-chat/shared'
import { Skeleton } from '@workspace/ui/components/skeleton'
import { lazy, Suspense } from 'react'
import { toast } from 'sonner'
import { AgentApprovalCard } from '@/components/Agent'
import { DEFAULT_TITLE } from '@/constants'
import { useChatSettingsContext } from '@/contexts/chatSettings'
import { approveAgentActionWithWhitelist, rejectAgentAction, startAgentTurn, useAgentStore } from '@/store/agent'
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

  const { settings, updateSettings } = useChatSettingsContext()
  const agentTask = useAgentStore(state => state.getActiveTaskByConversation(activeConversationsId))
  const agentTaskId = agentTask?.taskId
  const pending = useAgentStore(state => (agentTaskId ? state.pendingByTask[agentTaskId] : undefined))

  async function onSubmit(
    content: IMessageContent,
    referencedFiles: string[],
    selectedSkill: string | undefined,
    features: ChatFeatures,
    agentMode: AgentMode,
  ) {
    if (!settings.modelId) {
      toast.error('请选择模型')
      return
    }

    // 从 content 中提取文本作为 prompt
    const textBlocks = content.filter(block => block.type === 'text')
    const prompt = textBlocks.map(block => block.text).join('\n')

    const isNewConversation = !activeConversationsId
    const result = await startAgentTurn({
      conversationId: activeConversationsId || undefined,
      prompt,
      content,
      referencedFiles,
      selectedSkill,
      mode: agentMode,
      workspacePath: currentWorkspacePath || undefined,
      modelConfig: {
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
        void initConversationsTitle(result.conversationId)
      }, 1000)
    }
  }

  return (
    <div
      key={currentConversations?.id}
      className="relative mx-auto grid h-full w-full grid-rows-[1fr_max-content]"
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
      <div className="px-3 pb-3 md:px-2 md:pb-4">
        {agentTask && pending
          ? (
              <AgentApprovalCard
                pending={pending}
                workspacePath={currentWorkspacePath}
                onApprove={(remember, workspacePath) => {
                  void approveAgentActionWithWhitelist({
                    taskId: agentTask.taskId,
                    actionId: pending.actionId,
                    remember,
                    workspacePath,
                  })
                }}
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
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
    </div>
  )
}
