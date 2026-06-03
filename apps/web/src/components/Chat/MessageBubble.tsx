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
import { Separator } from '@workspace/ui/components/separator'
import { cn } from '@workspace/ui/lib/utils'
import { ChevronRightIcon, ShrinkIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Role } from '@/constants'
import { transformMessageContent } from '@/utils/messageTransform'
import { AssistantTrace } from './AssistantTrace'
import BubbleFooter from './BubbleFooter'
import MessageContent from './MessageContent'

interface MessageBubbleProps {
  messages: IMessage[]
  collapseIntermediate: boolean
  onCopyMessage: (message: IMessage) => void
}

export function MessageBubble({ messages, collapseIntermediate, onCopyMessage }: MessageBubbleProps) {
  const [isProcessOpen, setIsProcessOpen] = useState(false)
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

  // Determine if the last assistant message has reasoning / is running (for fold decisions).
  // Must be computed before early returns to keep hook order stable.
  const nonToolForFold = messages.filter(m => m.role !== 'tool')
  const lastNonTool = nonToolForFold[nonToolForFold.length - 1]
  const isRunning = lastNonTool?.status === 'loading' || lastNonTool?.status === 'typing'

  // Auto-open fold only while the conversation is streaming
  useEffect(() => {
    if (collapseIntermediate && isRunning && nonToolForFold.length > 1) {
      setIsProcessOpen(true)
    }
  }, [collapseIntermediate, isRunning, nonToolForFold.length])

  // Event messages: render as collapsible divider
  if (isEvent) {
    const eventLabel = message.eventType === 'compaction' ? '上下文压缩' : message.eventType
    const eventText = typeof message.content === 'string'
      ? message.content
      : message.content.filter(b => b.type === 'text').map(b => b.text).join('\n')

    return (
      <div className="mx-auto flex w-full max-w-(--chat-width) items-center gap-3 py-3">
        <div className="h-px flex-1 bg-border" />
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="
                h-7 gap-1.5 text-xs text-muted-foreground
                hover:text-foreground
              "
            >
              <ShrinkIcon className="size-3" />
              {eventLabel}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="
            mt-2 max-h-40 overflow-y-auto rounded-lg bg-muted/50 p-3 text-xs whitespace-pre-wrap
            text-muted-foreground
          "
          >
            {eventText}
          </CollapsibleContent>
        </Collapsible>
        <div className="h-px flex-1 bg-border" />
      </div>
    )
  }

  // Show only non-tool messages (assistant + user)
  const nonToolMessages = nonToolForFold

  if (nonToolMessages.length === 0)
    return null

  // Split messages into process (fold) and visible:
  // - Messages without text → always in fold
  // - Messages with tool calls → always in fold
  // - The last message stays visible (its text is the final answer),
  //   but its reasoning is extracted into a virtual message in the fold
  const processIds = new Set<string>()
  const processMessages: IMessage[] = []

  for (const m of nonToolMessages) {
    if (!messageHasTextContent(m) || messageHasToolCalls(m)) {
      processMessages.push(m)
      processIds.add(m.id)
    }
  }

  // Extract reasoning from the last message into the fold
  const lastNonToolMsg = nonToolMessages[nonToolMessages.length - 1]
  if (lastNonToolMsg?.reasoningContent && !processIds.has(lastNonToolMsg.id)) {
    processMessages.push({
      ...lastNonToolMsg,
      id: `${lastNonToolMsg.id}:reasoning-fold`,
      content: [],
    })
  }

  const visibleMessages = nonToolMessages.filter(m => !processIds.has(m.id))

  const shouldCollapseProcess = isAI && collapseIntermediate && processMessages.length > 0

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
              {shouldCollapseProcess && (
                <Collapsible
                  className="mb-0"
                  open={isProcessOpen}
                  onOpenChange={setIsProcessOpen}
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
                          isProcessOpen ? 'rotate-90' : undefined,
                        )}
                      />
                      {`execution process (${processMessages.length})`}
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
              )}

              {visibleMessages.map((item, index) => (
                <div
                  key={item.id}
                  data-message-id={item.id}
                >
                  {
                    (index > 0 || shouldCollapseProcess) && (
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

// ---- helpers ----

function messageHasTextContent(msg: IMessage): boolean {
  return Array.isArray(msg.content) && msg.content.some(b => b.type === 'text' && b.text.length > 0)
}

function messageHasToolCalls(msg: IMessage): boolean {
  return Array.isArray(msg.content) && msg.content.some(b => b.type === 'tool-call')
}

function hasToolCallBlocks(msgs: IMessage[]): boolean {
  return msgs.some(m =>
    Array.isArray(m.content) && m.content.some(b => b.type === 'tool-call'),
  )
}
