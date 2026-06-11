import type { IMessage } from '@ant-chat/shared'
import {
  MessageContent as AiMessageContent,
  Message,
} from '@workspace/ui/components/ai-elements/message'
import {
  Shimmer,
} from '@workspace/ui/components/ai-elements/shimmer'
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
import { formatTime } from '@/utils'
import { transformMessageContent } from '@/utils/messageTransform'
import { AssistantTrace } from './AssistantTrace'
import BubbleFooter from './BubbleFooter'
import MessageContent from './MessageContent'

interface MessageBubbleProps {
  messages: IMessage[]
  onCopyMessage: (message: IMessage) => void
}

type ProcessEntry
  = | { type: 'assistant', message: IMessage }
    | { type: 'steering', message: IMessage }

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
  const assistantMessages = messages.filter(m => m.role === 'assistant')
  const lastAssistant = assistantMessages.at(-1)
  const footerMessage = lastAssistant || message
  const isRunning = lastAssistant?.role === 'assistant'
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
            <PopoverTrigger asChild>
              <Button type="button" variant="ghost" size="sm" className={triggerClass}>
                <ShrinkIcon className="size-3" />
                {eventLabel}
              </Button>
            </PopoverTrigger>
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

  const { processEntries, visibleMessages } = isAI
    ? splitTurnMessages(nonToolMessages)
    : { processEntries: [], visibleMessages: nonToolMessages }
  const shouldShowProcess = isAI && processEntries.length > 0

  const taskDurationMs = lastAssistant?.durationMs

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
                  processEntries={processEntries}
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
            message={footerMessage}
            time={footerMessage.createdAt}
            modelInfo={isAI ? footerMessage.modelInfo : undefined}
            onCopy={() => onCopyMessage(footerMessage)}
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
        status={item.status as 'success' | 'loading' | 'typing'}
        enableReferenceTokens
      />
    )
  }

  return <AssistantTrace message={item} toolResultMap={toolResultMap} showReasoning={showReasoning} />
}

function ProcessMessagesPanel({
  processEntries,
  toolResultMap,
  defaultOpen,
}: {
  processEntries: ProcessEntry[]
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
          {`执行过程(${processEntries.length})`}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-3">
          {processEntries.map(entry => (
            entry.type === 'steering'
              ? <SteeringMessage key={entry.message.id} message={entry.message} />
              : (
                  <div
                    key={entry.message.id}
                    data-message-id={entry.message.id}
                  >
                    <AssistantMessageContent
                      item={entry.message}
                      toolResultMap={toolResultMap}
                    />
                  </div>
                )
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function SteeringMessage({ message }: { message: IMessage }) {
  return (
    <div
      className="ml-3 mr-1 border-l-2 border-primary/25 py-1 pl-4"
      data-message-id={message.id}
    >
      <div className="rounded-lg bg-primary/8 px-3 py-2.5 ring-1 ring-primary/18">
        <div className="mb-1 flex items-center justify-between gap-3">
          <span className="text-xs font-medium text-primary">
            追加指令
          </span>
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {formatTime(message.createdAt)}
          </span>
        </div>
        <MessageContent
          content={transformMessageContent(message)}
          status={message.status as 'success' | 'loading' | 'typing'}
          enableReferenceTokens
        />
      </div>
    </div>
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
  processEntries: ProcessEntry[]
  visibleMessages: IMessage[]
}

/**
 * Keep the latest assistant text response visible. Earlier assistant work and
 * steering messages retain their chronological position in the process panel.
 */
function splitTurnMessages(messages: IMessage[]): ProcessSplit {
  const assistantMessages = messages.filter(message => message.role === Role.AI)
  const visibleMessage = [...assistantMessages]
    .reverse()
    .find(message => messageHasTextContent(message) && !messageHasToolCalls(message))
  const processEntries: ProcessEntry[] = []

  for (const message of messages) {
    if (message.role === Role.USER) {
      processEntries.push({ type: 'steering', message })
      continue
    }

    if (message.id === visibleMessage?.id) {
      if (message.reasoningContent) {
        processEntries.push({
          type: 'assistant',
          message: {
            ...message,
            id: `${message.id}:reasoning-fold`,
            content: [],
          },
        })
      }
      continue
    }

    processEntries.push({ type: 'assistant', message })
  }

  return {
    processEntries,
    visibleMessages: visibleMessage ? [visibleMessage] : [],
  }
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
