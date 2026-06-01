import type { IMessage } from '@ant-chat/shared'
import type { BubbleContent } from '@/types/global'
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
import { cn } from '@workspace/ui/lib/utils'
import { pick } from 'lodash-es'
import { ChevronRightIcon, ShrinkIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Role } from '@/constants'
import { transformMessageContent } from '@/utils/messageTransform'
import BubbleFooter from './BubbleFooter'
import { McpToolCallPanel } from './McpToolCallPanel'
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

  // 建立 toolCallId → tool-result 消息的索引
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

  // 事件消息：渲染为可折叠分隔线
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

  // 只展示 non-tool 消息（assistant + user）
  const nonToolMessages = messages.filter(m => m.role !== 'tool')
  if (nonToolMessages.length === 0)
    return null

  const shouldCollapseProcess = isAI && collapseIntermediate && nonToolMessages.length > 1
  const processMessages = shouldCollapseProcess ? nonToolMessages.slice(0, -1) : []
  const visibleMessages = shouldCollapseProcess ? nonToolMessages.slice(-1) : nonToolMessages

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
                        <MessageContentRenderer
                          item={item}
                          content={transformMessageContent(item)}
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
                  className={cn(
                    (index > 0 || shouldCollapseProcess) && `
                      border-t border-gray-200 pt-5
                      dark:border-gray-800
                    `,
                  )}
                  data-message-id={item.id}
                >
                  <MessageContentRenderer
                    item={item}
                    content={transformMessageContent(item)}
                    toolResultMap={toolResultMap}
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

type RenderSegment
  = | { kind: 'text', text: string, isFirst: boolean }
    | { kind: 'tool-call', block: IMessage['content'][number] & { type: 'tool-call' } }

function buildRenderSegments(item: IMessage): RenderSegment[] {
  if (typeof item.content === 'string')
    return [{ kind: 'text', text: item.content, isFirst: true }]

  const segments: RenderSegment[] = []
  let isFirstText = true

  for (const block of item.content) {
    if (block.type === 'text') {
      segments.push({ kind: 'text', text: block.text, isFirst: isFirstText })
      isFirstText = false
    }
    else if (block.type === 'error') {
      segments.push({ kind: 'text', text: `${block.error}`, isFirst: isFirstText })
      isFirstText = false
    }
    else if (block.type === 'tool-call') {
      segments.push({ kind: 'tool-call', block })
    }
  }

  return segments
}

function MessageContentRenderer({
  item,
  content,
  toolResultMap,
}: {
  item: IMessage
  content: string
  toolResultMap: Map<string, IMessage>
}) {
  const itemIsUser = item.role === Role.USER
  const itemIsAI = item.role === Role.AI

  if (!itemIsAI) {
    const messageContentProps: Partial<BubbleContent> = {
      ...pick(item, ['status']),
      content,
    }
    return <MessageContent {...messageContentProps} enableReferenceTokens={itemIsUser} />
  }

  const segments = buildRenderSegments(item)

  return (
    <>
      {segments.map((seg, i) => {
        if (seg.kind === 'tool-call') {
          const resultMsg = toolResultMap.get(seg.block.toolCallId)
          const resultBlock = resultMsg?.content.find(
            (b): b is typeof b & { type: 'tool-result' } => b.type === 'tool-result',
          )
          return (
            <div key={seg.block.toolCallId || i} className="my-2">
              <McpToolCallPanel
                toolCall={seg.block}
                toolResult={resultBlock}
              />
            </div>
          )
        }
        return (
          <MessageContent
            key={i}
            content={seg.text}
            reasoningContent={seg.isFirst ? item.reasoningContent : undefined}
            status={item.status}
          />
        )
      })}
    </>
  )
}

function hasToolCallBlocks(msgs: IMessage[]): boolean {
  return msgs.some(m =>
    Array.isArray(m.content) && m.content.some(b => b.type === 'tool-call'),
  )
}
