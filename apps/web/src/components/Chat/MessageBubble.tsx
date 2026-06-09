import type { IMessage } from '@ant-chat/shared'
import {
  MessageContent as AiMessageContent,
  Message,
} from '@workspace/ui/components/ai-elements/message'
import { Button } from '@workspace/ui/components/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@workspace/ui/components/collapsible'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@workspace/ui/components/popover'
import { Separator } from '@workspace/ui/components/separator'
import { cn } from '@workspace/ui/lib/utils'
import { ChevronRightIcon, Loader2Icon, ShrinkIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Role } from '@/constants'
import { transformMessageContent } from '@/utils/messageTransform'
import { AssistantTrace } from './AssistantTrace'
import BubbleFooter from './BubbleFooter'
import MessageContent from './MessageContent'

interface MessageBubbleProps {
  messages: IMessage[]
  onCopyMessage: (message: IMessage) => void
}

export function MessageBubble({ messages, onCopyMessage }: MessageBubbleProps) {
  const message = messages[0]
  const isUser = message.role === Role.USER
  const isAI = message.role === Role.AI
  const isEvent = message.role === Role.EVENT

  // Build toolCallId → tool-result message index
  const toolResultMap = useMemo(() => {
    const map = new Map<string, IMessage>()
    for (const m of messages) {
      if (m.role === 'tool') {
        for (const block of m.content) {
          if (block.type === 'tool-result') {
            map.set(block.toolCallId, m)
          }
        }
      }
    }
    return map
  }, [messages])

  // Determine if the last assistant message is running (for fold decisions).
  // Exclude tool and event messages — only assistant streaming should auto-expand.
  const nonToolForFold = messages.filter(m => m.role !== 'tool' && m.role !== 'event')
  const lastNonTool = nonToolForFold[nonToolForFold.length - 1]
  const isRunning = lastNonTool?.role === 'assistant'
    && (
      lastNonTool?.status === 'loading'
      || lastNonTool?.status === 'typing'
      || hasExecutingToolCalls(lastNonTool, toolResultMap)
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

    return (
      <div className="mx-auto flex w-full max-w-(--chat-width) items-center gap-3 py-3">
        <div className="h-px flex-1 bg-border" />
        {isCompacting
          ? (
              <span className="flex h-7 shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2Icon className="size-3 animate-spin" />
                {eventLabel}
              </span>
            )
          : isCompactError
            ? (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1.5 text-xs text-destructive hover:text-destructive"
                    >
                      <ShrinkIcon className="size-3" />
                      {eventLabel}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="center"
                    className="max-h-64 max-w-lg overflow-y-auto text-xs whitespace-pre-wrap text-destructive"
                  >
                    {eventText}
                  </PopoverContent>
                </Popover>
              )
            : hasSummary
              ? (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <ShrinkIcon className="size-3" />
                        {eventLabel}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="center"
                      className="max-h-64 max-w-lg overflow-y-auto text-xs whitespace-pre-wrap"
                    >
                      {eventText}
                    </PopoverContent>
                  </Popover>
                )
              : (
                  <span className="flex h-7 shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                    <ShrinkIcon className="size-3" />
                    {eventLabel}
                  </span>
                )}
        <div className="h-px flex-1 bg-border" />
      </div>
    )
  }

  // Show only non-tool messages (assistant + user)
  const nonToolMessages = nonToolForFold

  if (nonToolMessages.length === 0)
    return null

  const { processMessages, visibleMessages } = splitProcessMessages(nonToolMessages)
  const shouldShowProcess = isAI && processMessages.length > 0

  // 从最后一个可见消息获取任务耗时
  const lastVisibleMsg = visibleMessages[visibleMessages.length - 1]
  const taskDurationMs = lastVisibleMsg?.durationMs

  return (
    <Message
      from={message.role === Role.USER ? 'user' : 'assistant'}
      className="mx-auto w-full max-w-(--chat-width)"
      data-message-id={message.id}
    >
      <div className={cn('flex items-start', isUser && 'justify-end')}>
        <div className={cn('min-w-0 flex-1', isUser && 'flex flex-col items-end')}>
          <AiMessageContent
            className={isAI && hasToolCallBlocks(messages)
              ? 'w-full'
              : undefined}
          >
            <div className={cn('space-y-5', isUser && 'space-y-3')}>
              {shouldShowProcess && (
                <ProcessMessagesPanel
                  key={isRunning ? 'running' : 'settled'}
                  processMessages={processMessages}
                  toolResultMap={toolResultMap}
                  defaultOpen={isRunning}
                />
              )}

              {visibleMessages.map((item, index) => (
                <div
                  key={item.id}
                  data-message-id={item.id}
                >
                  {
                    (index > 0 || shouldShowProcess) && (
                      <Separator className="my-3" />
                    )
                  }
                  <AssistantMessageContent
                    item={item}
                    toolResultMap={toolResultMap}
                    showReasoning={false}
                  />
                </div>
              ))}
            </div>
          </AiMessageContent>

          <BubbleFooter
            message={message}
            time={message.createdAt}
            modelInfo={isAI ? message.modelInfo : undefined}
            onCopy={onCopyMessage}
            durationMs={isAI ? taskDurationMs : undefined}
          />
        </div>
      </div>
    </Message>
  )
}

// ---- per-message content renderer ----

function AssistantMessageContent({
  item,
  toolResultMap,
  showReasoning = true,
}: {
  item: IMessage
  toolResultMap: Map<string, IMessage>
  showReasoning?: boolean
}) {
  if (item.role !== Role.AI) {
    return (
      <MessageContent
        content={transformMessageContent(item)}
        status={item.status as 'success' | 'cancel'}
        enableReferenceTokens
      />
    )
  }

  return <AssistantTrace message={item} toolResultMap={toolResultMap} showReasoning={showReasoning} />
}

function ProcessMessagesPanel({
  processMessages,
  toolResultMap,
  defaultOpen,
}: {
  processMessages: IMessage[]
  toolResultMap: Map<string, IMessage>
  defaultOpen: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <Collapsible
      className="mb-0"
      open={open}
      onOpenChange={setOpen}
    >
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mb-1 h-7 px-2 text-gray-500"
        >
          <ChevronRightIcon
            className={cn(
              'size-4 transition-transform',
              open ? 'rotate-90' : undefined,
            )}
          />
          {`执行过程(${processMessages.length})`}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {processMessages.map(item => (
          <div
            key={item.id}
            data-message-id={item.id}
          >
            <AssistantMessageContent
              item={item}
              toolResultMap={toolResultMap}
            />
          </div>
        ))}
      </CollapsibleContent>
    </Collapsible>
  )
}

// ---- helpers ----

function messageHasTextContent(msg: IMessage): boolean {
  return Array.isArray(msg.content) && msg.content.some(b => b.type === 'text' && b.text.length > 0)
}

function messageHasToolCalls(msg: IMessage): boolean {
  return Array.isArray(msg.content) && msg.content.some(b => b.type === 'tool-call')
}

interface ProcessSplit {
  processMessages: IMessage[]
  visibleMessages: IMessage[]
}

/**
 * Split non-tool messages into process (fold) and visible:
 * - Messages without text → fold
 * - Messages with tool calls → fold
 * - The last message stays visible (its text is the final answer);
 *   its reasoning is extracted into a virtual message in the fold.
 */
function splitProcessMessages(messages: IMessage[]): ProcessSplit {
  const processIds = new Set<string>()
  const processMessages: IMessage[] = []

  for (const m of messages) {
    if (!messageHasTextContent(m) || messageHasToolCalls(m)) {
      processMessages.push(m)
      processIds.add(m.id)
    }
  }

  // Extract reasoning from the last message into the fold
  const lastMsg = messages[messages.length - 1]
  if (lastMsg?.reasoningContent && !processIds.has(lastMsg.id)) {
    processMessages.push({
      ...lastMsg,
      id: `${lastMsg.id}:reasoning-fold`,
      content: [],
    })
  }

  const visibleMessages = messages.filter(m => !processIds.has(m.id))

  return { processMessages, visibleMessages }
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
