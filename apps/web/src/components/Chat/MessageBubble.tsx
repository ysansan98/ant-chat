import type { IMessage } from '@ant-chat/shared'
import type { ReactNode } from 'react'
import type { AnnotationState } from './TurnTrace'
import {
  MessageContent as AiMessageContent,
  Message,
} from '@workspace/ui/components/ai-elements/message'
import {
  Shimmer,
} from '@workspace/ui/components/ai-elements/shimmer'
import { Alert, AlertDescription, AlertTitle } from '@workspace/ui/components/alert'
import { Button } from '@workspace/ui/components/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@workspace/ui/components/popover'
import { cn } from '@workspace/ui/lib/utils'
import { Loader2Icon, ShrinkIcon } from 'lucide-react'
import { useMemo } from 'react'
import { Role } from '@/constants'
import { useAnnotationDraftsStore } from '@/store/annotations'
import { extractMessageAttachments } from '@/utils/extractMessageAttachments'
import { AnnotationSummaryBlock } from './annotations/AnnotationSummaryBlock'
import BubbleFooter from './BubbleFooter'
import MessageContent, { MessageAttachments } from './MessageContent'
import { buildToolResultMap } from './turnSteps'
import { TurnErrorAlert, TurnTrace } from './TurnTrace'

interface MessageBubbleProps {
  messages: IMessage[]
  onCopyMessage: (message: IMessage) => void
  turnStatus?: ReactNode
}

export function MessageBubble({ messages, onCopyMessage, turnStatus }: MessageBubbleProps) {
  // 批注编辑态：发送前临时状态，由全局 store 持有（Sender 发送前预览同源）
  const annotationDrafts = useAnnotationDraftsStore(state => state.drafts)
  const activeAnnotationId = useAnnotationDraftsStore(state => state.activeId)
  const addAnnotation = useAnnotationDraftsStore(state => state.add)
  const updateAnnotation = useAnnotationDraftsStore(state => state.update)
  const removeAnnotation = useAnnotationDraftsStore(state => state.remove)
  const activateAnnotation = useAnnotationDraftsStore(state => state.activate)
  const editingDraftId = useAnnotationDraftsStore(state => state.editingDraftId)
  const requestDraftEdit = useAnnotationDraftsStore(state => state.requestDraftEdit)

  const annotationState: AnnotationState = {
    drafts: annotationDrafts,
    activeId: activeAnnotationId,
    onAdd: addAnnotation,
    onUpdate: updateAnnotation,
    onRemove: removeAnnotation,
    onActivate: activateAnnotation,
    editingDraftId,
    onDraftEditConsumed: () => {
      requestDraftEdit(null)
    },
  }

  const message = messages[0]
  const isUser = message.role === Role.USER
  const isAI = message.role === Role.AI
  const isEvent = message.role === Role.EVENT

  // Build toolCallId → tool-result message index
  const toolResultMap = useMemo(() => buildToolResultMap(messages), [messages])

  // Determine if the last assistant message is running (for fold decisions).
  // Exclude tool and event messages — only assistant streaming should auto-expand.
  const assistantMessages = messages.filter(m => m.role === 'assistant')
  const lastAssistant = assistantMessages.at(-1)
  const footerMessage = lastAssistant || message
  const isAssistantStreaming = lastAssistant?.role === 'assistant'
    && (
      lastAssistant.status === 'loading'
      || lastAssistant.status === 'typing'
      || hasExecutingToolCalls(lastAssistant, toolResultMap)
    )

  // Event messages: render as collapsible divider
  if (isEvent) {
    const isCompaction = message.eventType === 'compaction'
    const isCompacting = isCompaction && message.status === 'loading'
    const isCompactError = isCompaction && message.status === 'error'

    const eventLabel = isCompaction
      ? isCompacting
        ? '正在压缩上下文'
        : isCompactError
          ? '上下文压缩失败'
          : '上下文已压缩'
      : message.eventType === 'fork'
        ? '会话 Fork'
        : message.eventType

    const eventText = typeof message.content === 'string'
      ? message.content
      : message.content.filter(b => b.type === 'text').map(b => b.text).join('\n')

    const hasSummary = isCompaction && !isCompacting && !isCompactError && eventText.length > 0

    const renderEventContent = () => {
      if (isCompacting) {
        return (
          <span className="flex h-7 shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2Icon className="size-3 animate-spin" />
            <Shimmer>
              {eventLabel as string}
            </Shimmer>
          </span>
        )
      }

      const showPopover = isCompactError || hasSummary
      const triggerClass = isCompactError
        ? 'h-7 gap-1.5 text-xs text-destructive hover:text-destructive'
        : 'h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground'
      const contentClass = isCompactError
        ? 'max-h-64 max-w-lg overflow-y-auto text-xs whitespace-pre-wrap text-destructive'
        : 'max-h-64 max-w-lg overflow-y-auto text-xs whitespace-pre-wrap'

      if (showPopover) {
        return (
          <Popover>
            <PopoverTrigger render={(
              <Button type="button" variant="ghost" size="sm" className={triggerClass}>
                <ShrinkIcon className="size-3" />
                {eventLabel}
              </Button>
            )}
            />
            <PopoverContent align="center" className={contentClass}>
              {eventText}
            </PopoverContent>
          </Popover>
        )
      }

      return (
        <span className="flex h-7 shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
          <ShrinkIcon className="size-3" />
          {eventLabel}
        </span>
      )
    }

    return (
      <div className="mx-auto flex w-full max-w-(--chat-width) items-center gap-3 py-3">
        <div className="h-px flex-1 bg-border" />
        {renderEventContent()}
        <div className="h-px flex-1 bg-border" />
      </div>
    )
  }

  // Show only non-tool messages (assistant + user)
  const nonToolMessages = messages.filter(m => m.role !== 'tool' && m.role !== 'event')

  if (nonToolMessages.length === 0)
    return null

  const taskDurationMs = lastAssistant?.durationMs
  const taskStartedAt = assistantMessages[0]?.createdAt ?? footerMessage.createdAt
  const isRunning = isAssistantStreaming
    || (taskDurationMs == null && hasToolCallAfterLastVisibleResponse(assistantMessages))

  // error block 由 TurnTrace 原位渲染；这里只处理没有 error block 的失败兜底与取消终态。
  const statusAlertMessages = isAI
    ? assistantMessages.filter(m =>
        m.status === 'cancel'
        || (m.status === 'error' && !messageHasErrorContent(m)),
      )
    : []

  return (
    <Message
      from={message.role === Role.USER ? 'user' : 'assistant'}
      className="mx-auto w-full max-w-(--chat-width)"
      data-message-id={message.id}
    >
      <div className={cn('flex items-start', isUser && 'justify-end')}>
        <div className={cn('min-w-0 flex-1', isUser && 'flex flex-col items-end')}>
          {isAI
            ? (
                <AiMessageContent
                  className={hasToolCallBlocks(messages) ? 'w-full' : undefined}
                >
                  <div className="space-y-3">
                    <TurnTrace
                      messages={nonToolMessages}
                      toolResultMap={toolResultMap}
                      turnRunning={isRunning}
                      annotationState={annotationState}
                    />
                    {statusAlertMessages.map(item => (
                      <TurnStatusAlert key={item.id} message={item} />
                    ))}
                  </div>
                </AiMessageContent>
              )
            : (
                <div className="space-y-3">
                  {nonToolMessages.map(item => (
                    <UserMessageBubble key={item.id} item={item} />
                  ))}
                </div>
              )}

          {turnStatus}

          <BubbleFooter
            message={footerMessage}
            time={footerMessage.createdAt}
            modelInfo={isAI ? footerMessage.modelInfo : undefined}
            onCopy={() => onCopyMessage(footerMessage)}
            durationMs={isAI ? taskDurationMs : undefined}
            startedAt={isAI ? taskStartedAt : undefined}
            running={isAI ? isRunning : undefined}
          />
        </div>
      </div>
    </Message>
  )
}

// ---- 用户消息：气泡内只渲染文本，附件渲染在气泡下方 ----

function UserMessageBubble({ item }: { item: IMessage }) {
  const { images, attachments } = extractMessageAttachments(item)
  // 批注由 AnnotationSummaryBlock 独立渲染，这里只保留普通文本，避免平铺"引用：…"
  const text = item.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')
  const annotations = item.content
    .map((block, index) => ({ block, index }))
    .filter((item2): item2 is { block: IMessage['content'][number] & { type: 'annotation' }, index: number } => item2.block.type === 'annotation')

  return (
    <div className="flex flex-col items-end gap-2" data-message-id={item.id}>
      {/* 已发送批注只读展示：对话历史是真相源，不允许在消息列表中改写 */}
      <AnnotationSummaryBlock
        items={annotations.map(({ block, index }) => ({
          id: String(index),
          quote: block.quote,
          comment: block.comment,
          targetMessageId: block.targetMessageId,
        }))}
      />
      {text.length > 0 && (
        <AiMessageContent>
          <MessageContent
            content={text}
            status={item.status}
            enableReferenceTokens
          />
        </AiMessageContent>
      )}
      {(images.length > 0 || attachments.length > 0) && (
        <MessageAttachments images={images} attachments={attachments} />
      )}
    </div>
  )
}

/** turn 结束态的整气泡提示：请求失败 / 任务取消（无正文时） */
function TurnStatusAlert({ message }: { message: IMessage }) {
  if (message.status === 'error') {
    return <TurnErrorAlert error={getErrorText(message)} />
  }

  if (message.status === 'cancel' && !messageHasTextContent(message)) {
    return (
      <Alert variant="default">
        <AlertTitle>任务已取消</AlertTitle>
        <AlertDescription>
          <p>任务已取消。</p>
        </AlertDescription>
      </Alert>
    )
  }

  return null
}

// ---- helpers ----

function getErrorText(message: IMessage): string {
  if (!Array.isArray(message.content))
    return ''
  return message.content
    .filter(b => b.type === 'error')
    .map(b => b.error)
    .join('\n')
}

function messageHasTextContent(msg: IMessage): boolean {
  return Array.isArray(msg.content) && msg.content.some(b => b.type === 'text' && b.text.length > 0)
}

function messageHasErrorContent(msg: IMessage): boolean {
  return Array.isArray(msg.content) && msg.content.some(b => b.type === 'error')
}

function messageHasToolCalls(msg: IMessage): boolean {
  return Array.isArray(msg.content) && msg.content.some(b => b.type === 'tool-call')
}

function hasToolCallBlocks(msgs: IMessage[]): boolean {
  return msgs.some(m =>
    Array.isArray(m.content) && m.content.some(b => b.type === 'tool-call'),
  )
}

function hasExecutingToolCalls(msg: IMessage, toolResultMap: Map<string, IMessage>): boolean {
  if (!Array.isArray(msg.content))
    return false
  return msg.content.some(b =>
    b.type === 'tool-call'
    && (b.executeState === 'executing' || !toolResultMap.has(b.toolCallId)),
  )
}

/** Tool 完成后到下一段 assistant 文本出现前，本轮仍处于执行中。 */
function hasToolCallAfterLastVisibleResponse(messages: IMessage[]): boolean {
  let lastToolCallIndex = -1
  let lastVisibleResponseIndex = -1

  messages.forEach((message, index) => {
    if (messageHasToolCalls(message))
      lastToolCallIndex = index
    if (messageHasTextContent(message) && !messageHasToolCalls(message))
      lastVisibleResponseIndex = index
  })

  return lastToolCallIndex > lastVisibleResponseIndex
}
