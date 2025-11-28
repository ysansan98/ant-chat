import type { IMessage, MessageId } from '@ant-chat/shared'
import type { BubbleContent } from '@/types/global'
import { Bubble } from '@ant-design/x'
import { pick } from 'lodash-es'
import { Role } from '@/constants'
import { executeMcpToolAction } from '@/store/messages'
import { transformMessageContent } from '@/utils/messageTransform'
import BubbleFooter from './BubbleFooter'
import { BubbleHeader } from './BubbleHeader'
import { McpToolCallPanel } from './McpToolCallPanel'
import { MessageAvatar } from './MessageAvatar'
import MessageContent from './MessageContent'

interface MessageBubbleProps {
  message: IMessage
  onFooterButtonClick: (buttonName: string, message: IMessage) => void
  onExecuteAllCompleted?: (messageId: MessageId) => void
}

const leftBubbleContentStyle: React.CSSProperties = {
  marginRight: '44px',
}

const rightBubbleContentStyle: React.CSSProperties = {
  marginLeft: '44px',
}

export function MessageBubble({ message, onFooterButtonClick, onExecuteAllCompleted }: MessageBubbleProps) {
  const isUser = message.role === Role.USER
  const isAI = message.role === Role.AI

  // 计算样式
  const contentStyle = isUser ? rightBubbleContentStyle : leftBubbleContentStyle
  const bubbleStyle = isAI && message.mcpTool?.length
    ? { content: { width: 'calc(100% - 44px)' } }
    : { content: contentStyle }

  // 渲染消息内容
  const renderMessageContent = (content: string) => {
    if (!isAI) {
      const pickList = ['status']
      if (isUser) {
        pickList.push('images', 'attachments')
      }
      const messageContentProps: Partial<BubbleContent> = {
        ...pick(message, pickList),
        content,
      }
      return <MessageContent {...messageContentProps} />
    }

    return (
      <>
        <MessageContent
          content={content}
          reasoningContent={message.reasoningContent}
          status={message.status}
        />
        {isAI && message.mcpTool && (
          <div className="mt-3 flex flex-col gap-4">
            {message.mcpTool.map(tool => (
              <McpToolCallPanel
                key={tool.id}
                item={tool}
                onExecute={async (item) => {
                  const { isAllCompleted } = await executeMcpToolAction(message, item)
                  if (isAllCompleted) {
                    onExecuteAllCompleted?.(message.id)
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
    <Bubble
      loading={message.status === 'loading'}
      placement={isUser ? 'end' : 'start'}
      avatar={<MessageAvatar message={message} />}
      className="group mx-auto w-full max-w-(--chat-width)"
      typing={message.status === 'typing' ? { step: 1, interval: 50, effect: 'typing' } : false}
      styles={bubbleStyle}
      content={transformMessageContent(message)}
      contentRender={content => renderMessageContent(content)}
      header={<BubbleHeader time={message.createdAt} modelInfo={isAI ? message.modelInfo : undefined} />}
      footer={<BubbleFooter message={message} onClick={onFooterButtonClick} />}
    />
  )
}
