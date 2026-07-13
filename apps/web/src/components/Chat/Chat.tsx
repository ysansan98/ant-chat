import type { AgentMode, IMessageContent } from '@ant-chat/shared'
import { Skeleton } from '@workspace/ui/components/skeleton'
import { lazy, Suspense, useRef, useState } from 'react'
import { toast } from 'sonner'
import { skillApi } from '@/api/skillApi'
import { AgentApprovalCard, AgentSecretRequestCard } from '@/components/Agent'
import { useChatSettingsContext } from '@/contexts/chatSettings'
import { useBuiltinCommandSubmit } from '@/hooks/useBuiltinCommandSubmit'
import { abortConversationRuntime, approveAgentActionWithWhitelist, rejectAgentAction, rejectSecretRequestAction, resolveSecretRequestAction, startAgentTurn, useAgentRuntimeStore } from '@/store/agentRuntime'
import {
  setConversationState,
  upsertConversationAction,
  useConversationsStore,
} from '@/store/conversation'
import { setActiveConversationsId, useMessagesStore } from '@/store/messages'
import {
  editPendingMessage,
  enqueuePendingMessage,
  injectPendingMessage,
  removePendingMessage,
} from '@/store/pendingMessages'
import { useWorkspaceStore } from '@/store/workspace'
import Sender from '../Sender'

import { hasSkillReference, hasWorkspacePathReference } from '../Sender/builtinCommandParser'
import { buildTurnInput } from './buildTurnInput'
import { ContextDiagnosticsPanel } from './ContextDiagnostics'
import { ContextFloatingButton } from './ContextDiagnostics/ContextFloatingButton'
import { ConversationTitleBar } from './ConversationTitleBar'

const BubbleList = lazy(() => import('./BubbleList'))

async function resolveKnownSkillNames(text: string): Promise<ReadonlySet<string>> {
  if (!text.trimStart().startsWith('/')) {
    return new Set()
  }
  try {
    const { skills } = await skillApi.listSkills()
    return new Set(skills.filter(skill => skill.enabled).map(skill => skill.name))
  }
  catch {
    return new Set()
  }
}

export default function Chat() {
  const messages = useMessagesStore(state => state.messages)
  const activeConversationsId = useMessagesStore(state => state.activeConversationsId)
  const currentConversations = useConversationsStore(state => state.conversations.find(item => item.id === activeConversationsId))
  const currentWorkspacePath = useWorkspaceStore(state => state.currentWorkspacePath)

  const { settings, conversationInstructions, updateConversationInstructions } = useChatSettingsContext()
  const agentTask = useAgentRuntimeStore(state => state.getActiveTaskByConversation(activeConversationsId))
  const agentTaskId = agentTask?.taskId
  const pending = useAgentRuntimeStore(state => (agentTaskId ? state.pendingByTask[agentTaskId] : undefined))
  const secretRequest = useAgentRuntimeStore(state => Object.values(state.secretRequests).find(request => request.conversationId === activeConversationsId))

  const { commandRunning, submitCommand, cancelCommand } = useBuiltinCommandSubmit({
    settings: {
      modelId: settings.modelId || '',
      providerId: settings.providerId || '',
      temperature: settings.temperature,
      maxOutputTokens: settings.maxOutputTokens,
      reasoningEffort: settings.reasoningEffort,
    },
    conversationInstructions,
    currentWorkspacePath,
  })

  const senderRef = useRef<HTMLDivElement>(null)
  const chatContainerRef = useRef<HTMLDivElement>(null)

  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)
  const [diagnosticsWidth, setDiagnosticsWidth] = useState(420)

  async function onSubmit(
    content: IMessageContent,
    agentMode: AgentMode,
  ): Promise<boolean> {
    const textBlocks = content.filter(block => block.type === 'text')
    const draftText = textBlocks.map(block => block.text).join('\n')
    const knownSkillNames = await resolveKnownSkillNames(draftText)

    if (agentTask) {
      const hasAttachment = content.some(block => block.type !== 'text')
      if (hasAttachment || hasWorkspacePathReference(draftText) || hasSkillReference(draftText, knownSkillNames)) {
        toast.error('任务进行中，待处理消息暂不支持附件或引用')
        return false
      }
      enqueuePendingMessage(agentTask.conversationId, draftText)
      return true
    }

    if (!settings.modelId) {
      toast.error('请选择模型')
      return false
    }

    await updateConversationInstructions(conversationInstructions)

    // Try built-in command first
    const handled = await submitCommand(draftText, knownSkillNames)
    if (handled)
      return true

    // 捕获首条消息时 Sender 的旧位置（页面居中）
    const el = senderRef.current
    const oldRect = messages.length === 0 && el ? el.getBoundingClientRect() : undefined

    // Regular agent turn
    try {
      const result = await startAgentTurn(buildTurnInput({
        conversationId: activeConversationsId || undefined,
        messageContent: content,
        mode: agentMode,
        workspacePath: currentWorkspacePath,
        settings,
        conversationInstructions,
      }))
      upsertConversationAction(result.conversation)
      await setActiveConversationsId(result.conversationId)
      // setActiveConversationsId 内部的 syncConversationRuntime 可能清除状态，
      // 这里重新设置 running 确保即时响应，不等 agent:task-updated 回来
      setConversationState(result.conversationId, 'running')

      // FLIP 动画：输入框从居中位置平滑过渡到底部
      if (oldRect && el) {
        const newRect = el.getBoundingClientRect()
        const dy = oldRect.top - newRect.top
        if (Math.abs(dy) > 5) {
          el.style.transition = 'none'
          el.style.transform = `translateY(${dy}px)`
          el.getBoundingClientRect()
          requestAnimationFrame(() => {
            el.style.transition = 'transform 0.5s cubic-bezier(0.22, 1, 0.36, 1)'
            el.style.transform = ''
            const onEnd = () => {
              el.style.transition = ''
            }
            el.addEventListener('transitionend', onEnd, { once: true })
          })
        }
      }

      return true
    }
    catch (error) {
      toast.error(error instanceof Error ? error.message : '发送消息失败')
      throw error
    }
  }

  const hasMessages = messages.length > 0

  return (
    <div ref={chatContainerRef} className="relative flex size-full min-w-0">
      <div className="flex min-w-0 flex-1 flex-col">
        {currentConversations && (
          <ConversationTitleBar conversation={currentConversations} />
        )}
        <div className={`flex min-h-0 min-w-0 flex-1 flex-col ${!hasMessages ? 'justify-center' : ''}`}>
          {hasMessages && (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <Suspense fallback={<BubbleSkeleton />}>
                <BubbleList
                  key={currentConversations?.id}
                  messages={messages}
                />
              </Suspense>
            </div>
          )}
          <div
            ref={senderRef}
            className={`w-full min-w-0 px-2 md:px-3 ${hasMessages ? 'pb-[max(0.5rem,env(safe-area-inset-bottom))] md:pb-4' : ''}`}
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
              onSubmit={onSubmit}
              canInjectPendingMessage={true}
              onInjectPendingMessage={id => void injectPendingMessage(activeConversationsId, id)}
              onEditPendingMessage={(id, text) => editPendingMessage(activeConversationsId, id, text)}
              onRemovePendingMessage={id => removePendingMessage(activeConversationsId, id)}
              onCancel={async () => {
                if (commandRunning) {
                  await cancelCommand()
                  return
                }
                await abortConversationRuntime(activeConversationsId)
              }}
            />
          </div>
        </div>
      </div>

      {import.meta.env.DEV && !diagnosticsOpen && (
        <ContextFloatingButton
          containerRef={chatContainerRef}
          onOpen={() => setDiagnosticsOpen(true)}
        />
      )}

      {import.meta.env.DEV && diagnosticsOpen && (
        <ContextDiagnosticsPanel
          conversationId={activeConversationsId}
          isOpen={diagnosticsOpen}
          onClose={() => setDiagnosticsOpen(false)}
          width={diagnosticsWidth}
          onWidthChange={setDiagnosticsWidth}
        />
      )}
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
