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
import { useState } from 'react'
import { Role } from '@/constants'
import { detectCompactionMarker, transformMessageContent } from '@/utils/messageTransform'
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
  const compactionMarker = detectCompactionMarker(message)
  const isUser = message.role === Role.USER
  const isAI = message.role === Role.AI

  // 压缩标记：渲染为可折叠分隔线
  if (compactionMarker) {
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
              上下文压缩
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="
            mt-2 max-h-40 overflow-y-auto rounded-lg bg-muted/50 p-3 text-xs whitespace-pre-wrap
            text-muted-foreground
          "
          >
            {compactionMarker.summary}
          </CollapsibleContent>
        </Collapsible>
        <div className="h-px flex-1 bg-border" />
      </div>
    )
  }

  const shouldCollapseProcess = isAI && collapseIntermediate && messages.length > 1
  const processMessages = shouldCollapseProcess ? messages.slice(0, -1) : []
  const visibleMessages = shouldCollapseProcess ? messages.slice(-1) : messages

  const renderMessageContent = (item: IMessage, content: string) => {
    const itemIsUser = item.role === Role.USER
    const itemIsAI = item.role === Role.AI

    if (!itemIsAI) {
      const pickList = ['status']
      if (itemIsUser) {
        pickList.push('images', 'attachments')
      }
      const messageContentProps: Partial<BubbleContent> = {
        ...pick(item, pickList),
        content,
      }
      return <MessageContent {...messageContentProps} enableReferenceTokens={itemIsUser} />
    }

    return (
      <>
        <MessageContent
          content={content}
          reasoningContent={item.reasoningContent}
          status={item.status}
        />
        {itemIsAI && item.toolCalls && (
          <div className="mt-2 flex flex-col gap-2">
            {item.toolCalls.map(tool => (
              <McpToolCallPanel
                key={tool.id}
                item={tool}
              />
            ))}
          </div>
        )}
      </>
    )
  }

  return (
    <Message
      from={message.role === Role.USER ? 'user' : 'assistant'}
      className="mx-auto w-full max-w-(--chat-width)"
      data-message-id={message.id}
    >
      <div className={cn('flex items-start', isUser && 'justify-end')}>
        <div className={cn('min-w-0 flex-1', isUser && 'flex flex-col items-end')}>
          <AiMessageContent
            className={isAI && messages.some(item => item.toolCalls?.length)
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
                        {renderMessageContent(item, transformMessageContent(item))}
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
                  {renderMessageContent(item, transformMessageContent(item))}
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
