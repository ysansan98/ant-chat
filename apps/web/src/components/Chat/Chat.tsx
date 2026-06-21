import type { AgentMode, ChatFeatures, IMessageContent } from '@ant-chat/shared'
import { Skeleton } from '@workspace/ui/components/skeleton'
import { lazy, Suspense } from 'react'
import { toast } from 'sonner'
import { AgentApprovalCard, AgentSecretRequestCard } from '@/components/Agent'
import { useChatSettingsContext } from '@/contexts/chatSettings'
import { useBuiltinCommandSubmit } from '@/hooks/useBuiltinCommandSubmit'
import { approveAgentActionWithWhitelist, injectSteeringAction, rejectAgentAction, rejectSecretRequestAction, resolveSecretRequestAction, startAgentTurn, useAgentStore } from '@/store/agent'
import {
  upsertConversationAction,
  useConversationsStore,
} from '@/store/conversation'
import {
  abortActiveRequest,
  addPendingSteeringMessage,
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
  const secretRequest = useAgentStore(state => Object.values(state.secretRequests).find(request => request.conversationId === activeConversationsId))

  const { commandRunning, submitCommand, cancelCommand } = useBuiltinCommandSubmit({
    settings: {
      modelId: settings.modelId || '',
      providerId: settings.providerId || '',
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
    const textBlocks = content.filter(block => block.type === 'text')
    const draftText = textBlocks.map(block => block.text).join('\n')

    if (agentTask) {
      const message = await injectSteeringAction(agentTask.conversationId, draftText)
      addPendingSteeringMessage(message)
      return
    }

    if (!settings.modelId) {
      toast.error('请选择模型')
      return
    }

    // Try built-in command first
    const handled = await submitCommand(draftText, referencedFiles, selectedSkill)
    if (handled)
      return

    // Regular agent turn
    const prompt = draftText
    try {
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
    }
    catch (error) {
      toast.error(error instanceof Error ? error.message : '发送消息失败')
      throw error
    }
  }

  const hasMessages = messages.length > 0

  return (
    <div
      key={currentConversations?.id}
      className={`
        relative grid h-full min-w-0 w-full
        ${hasMessages ? 'grid-rows-[minmax(0,1fr)_auto]' : 'place-items-center'}
      `}
    >
      {hasMessages && (
        <div className="min-h-0 overflow-hidden">
          <Suspense fallback={<BubbleSkeleton />}>
            <BubbleList
              messages={messages}
              conversationsId={activeConversationsId}
            />
          </Suspense>
        </div>
      )}
      <div
        className={`
          w-full min-w-0 px-2
          md:px-3
          ${hasMessages ? 'pb-[max(0.5rem,env(safe-area-inset-bottom))] md:pb-4' : ''}
        `}
      >
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
        {secretRequest
          ? (
              <AgentSecretRequestCard
                request={secretRequest}
                onSubmit={values => void resolveSecretRequestAction(secretRequest.requestId, values)}
                onReject={() => void rejectSecretRequestAction(secretRequest.requestId)}
              />
            )
          : null}
        <Sender
          disabled={commandRunning}
          actions={(
            <ModelControlPanel
              value={{ modelId: settings.modelId, providerId: settings.providerId }}
              onChange={({ modelId, providerId }) => {
                updateSettings({ modelId, providerId })
              }}
            />
          )}
          onSubmit={onSubmit}
          onCancel={async () => {
            if (commandRunning) {
              await cancelCommand()
              return
            }
            await abortActiveRequest(activeConversationsId)
          }}
        />
      </div>
    </div>
  )
}

function BubbleSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-(--chat-width) flex-col gap-3 px-2 md:px-0">
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
    </div>
  )
}
