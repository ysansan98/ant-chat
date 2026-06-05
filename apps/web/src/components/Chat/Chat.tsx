import type { AgentMode, ChatFeatures, IMessageContent } from '@ant-chat/shared'
import { Skeleton } from '@workspace/ui/components/skeleton'
import { lazy, Suspense } from 'react'
import { toast } from 'sonner'
import { AgentApprovalCard } from '@/components/Agent'
import { DEFAULT_TITLE } from '@/constants'
import { useChatSettingsContext } from '@/contexts/chatSettings'
import { useBuiltinCommandSubmit } from '@/hooks/useBuiltinCommandSubmit'
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

  const { commandRunning, submitCommand, cancelCommand } = useBuiltinCommandSubmit({
    settings: {
      modelId: settings.modelId || '',
      systemPrompt: settings.systemPrompt,
      temperature: settings.temperature,
      maxTokens: settings.maxTokens,
    },
    currentWorkspacePath,
  })

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

    const textBlocks = content.filter(block => block.type === 'text')
    const draftText = textBlocks.map(block => block.text).join('\n')

    // Try built-in command first
    const handled = await submitCommand(draftText, referencedFiles, selectedSkill)
    if (handled)
      return

    // Regular agent turn
    const prompt = draftText
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

    if (currentConversations?.title === DEFAULT_TITLE || isNewConversation) {
      setTimeout(() => {
        void initConversationsTitle(result.conversationId)
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
                  isCompacting={commandRunning}
                />
              </Suspense>
            )
          : null
      }
      <div className="px-2 pb-4">
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
          disabled={commandRunning}
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
          onCancel={async () => {
            await cancelCommand()
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
