import type { AgentMode, IMessageContent } from '@ant-chat/shared'
import { Button } from '@workspace/ui/components/button'
import { Skeleton } from '@workspace/ui/components/skeleton'
import { cn } from '@workspace/ui/lib/utils'
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { skillApi } from '@/api/skillApi'
import { AgentApprovalCard, AgentSecretRequestCard } from '@/components/Agent'
import { useChatSettingsContext } from '@/contexts/chatSettings'
import { abortConversationRuntime, approveAgentAction, rejectAgentAction, rejectSecretRequestAction, resolveSecretRequestAction, useAgentRuntimeStore } from '@/store/agentRuntime'
import { useAnnotationDraftsStore } from '@/store/annotations'
import { useConversationsStore } from '@/store/conversation'
import { useMessagesStore } from '@/store/messages'
import {
  editPendingMessage,
  injectPendingMessage,
  removePendingMessage,
} from '@/store/pendingMessages'
import { cancelTurnCommand, submitTurnIntake } from '@/store/turnIntake'
import { useWorkspaceStore } from '@/store/workspace'
import { RightSidebar } from '../RightSidebar'
import Sender from '../Sender'
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

  const senderRef = useRef<HTMLDivElement>(null)
  const chatContainerRef = useRef<HTMLDivElement>(null)

  const [searchParams, setSearchParams] = useSearchParams()
  const initialTraceTurnId = searchParams.get('traceTurnId') ?? undefined
  const initialJumpMessageId = searchParams.get('jumpToMessage') ?? undefined
  const [focusedTraceTurnId] = useState<string | undefined>(initialTraceTurnId)
  const [commandRunning, setCommandRunning] = useState(false)
  // 右侧辅助栏默认收起；从消息跳转 Trace 时自动展开（Trace 标签由 RightSidebar 内部添加）
  const [sidebarOpen, setSidebarOpen] = useState(Boolean(initialTraceTurnId))

  // AgentApprovalCard 进入/退出动画
  const approvalVisible = !!(agentTask && pending)
  const [approvalMounted, setApprovalMounted] = useState(false)
  const [approvalState, setApprovalState] = useState<'open' | 'closed'>('closed')
  const approvalMountedRef = useRef(false)
  // 快照：退出动画期间 pending/agentTask 可能已被 store 清除，需要保留引用
  const snapshotPendingRef = useRef(pending)
  const snapshotAgentTaskRef = useRef(agentTask)
  if (pending) {
    snapshotPendingRef.current = pending
  }
  if (agentTask) {
    snapshotAgentTaskRef.current = agentTask
  }

  useEffect(() => {
    if (approvalVisible) {
      setApprovalMounted(true)
      approvalMountedRef.current = true
      const raf = requestAnimationFrame(() => setApprovalState('open'))
      return () => cancelAnimationFrame(raf)
    }

    if (approvalMountedRef.current) {
      setApprovalState('closed')
    }
    return undefined
  }, [approvalVisible])

  const handleApprovalAnimEnd = useCallback(() => {
    if (!approvalVisible && approvalState === 'closed') {
      setApprovalMounted(false)
      approvalMountedRef.current = false
    }
  }, [approvalVisible, approvalState])

  useEffect(() => {
    const turnId = searchParams.get('traceTurnId')
    const jumpToMessage = searchParams.get('jumpToMessage')
    if (!turnId && !jumpToMessage)
      return
    const next = new URLSearchParams(searchParams)
    next.delete('traceTurnId')
    next.delete('jumpToMessage')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  async function onSubmit(
    content: IMessageContent,
    agentMode: AgentMode,
  ): Promise<boolean> {
    // 批注随消息发送：把当前待发送批注组装为 annotation blocks，置于用户文本之前；
    // 命令/技能解析只基于 text 块，不受批注影响
    const annotationDrafts = useAnnotationDraftsStore.getState().drafts
    if (annotationDrafts.length > 0) {
      content = [
        ...annotationDrafts.map(draft => ({
          type: 'annotation' as const,
          quote: draft.quote,
          comment: draft.comment,
          targetMessageId: draft.targetMessageId,
        })),
        ...content,
      ]
    }

    const textBlocks = content.filter(block => block.type === 'text')
    const draftText = textBlocks.map(block => block.text).join('\n')
    const knownSkillNames = await resolveKnownSkillNames(draftText)

    await updateConversationInstructions(conversationInstructions)

    // 捕获首条消息时 Sender 的旧位置（页面居中）
    const el = senderRef.current
    const oldRect = messages.length === 0 && el ? el.getBoundingClientRect() : undefined

    // Regular agent turn
    try {
      const result = await submitTurnIntake({
        origin: 'chat',
        conversationId: activeConversationsId || undefined,
        messageContent: content,
        mode: agentMode,
        workspacePath: currentWorkspacePath,
        settings,
        conversationInstructions,
        knownSkillNames,
        onCommandRunningChange: setCommandRunning,
      })

      if (result.projectionWarning)
        toast.warning(result.projectionWarning)

      if (result.kind !== 'regular')
        return true

      // 批注已随消息发出，清空发送前草稿
      useAnnotationDraftsStore.getState().clear()

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
          <ConversationTitleBar
            conversation={currentConversations}
          />
        )}
        <div className={`flex min-h-0 min-w-0 flex-1 flex-col ${!hasMessages ? 'justify-center' : ''}`}>
          {hasMessages && (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <Suspense fallback={<BubbleSkeleton />}>
                <BubbleList
                  key={currentConversations?.id}
                  messages={messages}
                  initialJumpMessageId={initialJumpMessageId}
                />
              </Suspense>
            </div>
          )}
          <div
            ref={senderRef}
            className={`w-full min-w-0 px-2 md:px-3 ${hasMessages ? 'pb-[max(0.5rem,env(safe-area-inset-bottom))] md:pb-4' : ''}`}
          >
            {secretRequest
              ? (
                  <AgentSecretRequestCard
                    request={secretRequest}
                    onSubmit={values => void resolveSecretRequestAction(secretRequest.requestId, values)}
                    onReject={() => void rejectSecretRequestAction(secretRequest.requestId)}
                  />
                )
              : null}
            <div className="relative mx-auto w-full max-w-(--chat-width)">
              <Sender
                disabled={commandRunning}
                onSubmit={onSubmit}
                canInjectPendingMessage={true}
                onInjectPendingMessage={id => void injectPendingMessage(activeConversationsId, id)}
                onEditPendingMessage={(id, text) => editPendingMessage(activeConversationsId, id, text)}
                onRemovePendingMessage={id => removePendingMessage(activeConversationsId, id)}
                onCancel={async () => {
                  if (commandRunning) {
                    await cancelTurnCommand(activeConversationsId)
                    return
                  }
                  await abortConversationRuntime(activeConversationsId)
                }}
              />
              {approvalMounted && (
                <div
                  data-state={approvalState}
                  onAnimationEnd={handleApprovalAnimEnd}
                  className={cn(
                    'absolute inset-x-0 bottom-0 z-10',
                    'data-[state=open]:animate-in data-[state=open]:duration-300 data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-4',
                    'data-[state=closed]:animate-out data-[state=closed]:duration-200 data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-bottom-4',
                  )}
                >
                  <AgentApprovalCard
                    key={snapshotPendingRef.current?.actionId}
                    pending={snapshotPendingRef.current!}
                    onApprove={async (selection) => {
                      await approveAgentAction({
                        taskId: snapshotAgentTaskRef.current!.taskId,
                        actionId: snapshotPendingRef.current!.actionId,
                        selection,
                      })
                    }}
                    onReject={() => void rejectAgentAction({ taskId: snapshotAgentTaskRef.current!.taskId, actionId: snapshotPendingRef.current!.actionId, reason: '用户拒绝' })}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <RightSidebar
        open={sidebarOpen}
        conversationId={activeConversationsId}
        focusTurnId={focusedTraceTurnId}
        onClose={() => setSidebarOpen(false)}
      />
      {/* 固定在窗口右上角的侧栏开关：单个按钮常驻，icon 随展开/收起切换 */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute top-1 right-4 z-9990 text-muted-foreground"
        onClick={() => setSidebarOpen(open => !open)}
        aria-label={sidebarOpen ? '收起右侧栏' : '打开右侧栏'}
        title={sidebarOpen ? '收起右侧栏' : '打开右侧栏'}
      >
        <span
          className={`${sidebarOpen
            ? 'icon-[fluent--panel-right-24-filled]'
            : 'icon-[fluent--panel-right-24-regular]'}
            text-xl
          `}
        >

        </span>
      </Button>
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
