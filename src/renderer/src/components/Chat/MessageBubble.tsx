import type { IMessage, MessageId } from '@ant-chat/shared'
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
import { ChevronRightIcon } from 'lucide-react'
import { useState } from 'react'
import { Role } from '@/constants'
import { executeMcpToolAction } from '@/store/messages'
import { transformMessageContent } from '@/utils/messageTransform'
import BubbleFooter from './BubbleFooter'
import { McpToolCallPanel } from './McpToolCallPanel'
import MessageContent from './MessageContent'

interface MessageBubbleProps {
  messages: IMessage[]
  collapseIntermediate: boolean
  onCopyMessage: (message: IMessage) => void
  onExecuteAllCompleted?: (messageId: MessageId) => void
}

export function MessageBubble({ messages, collapseIntermediate, onCopyMessage, onExecuteAllCompleted }: MessageBubbleProps) {
  const [isProcessOpen, setIsProcessOpen] = useState(false)
  const message = messages[0]
  const isUser = message.role === Role.USER
  const isAI = message.role === Role.AI
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
      return <MessageContent {...messageContentProps} />
    }

    return (
      <>
        <MessageContent
          content={content}
          reasoningContent={item.reasoningContent}
          status={item.status}
        />
        {itemIsAI && item.mcpTool && (
          <div className="mt-2 flex flex-col gap-2">
            {item.mcpTool.map(tool => (
              <McpToolCallPanel
                key={tool.id}
                item={tool}
                onExecute={async (tool) => {
                  const { isAllCompleted } = await executeMcpToolAction(item, tool)
                  if (isAllCompleted) {
                    onExecuteAllCompleted?.(item.id)
                  }
                }}
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
            className={isAI && messages.some(item => item.mcpTool?.length)
              ? 'w-full'
              : undefined}
          >
            <div className={cn('space-y-5', isUser && 'space-y-3')}>
              {shouldCollapseProcess && (
                <Collapsible open={isProcessOpen} onOpenChange={setIsProcessOpen}>
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
