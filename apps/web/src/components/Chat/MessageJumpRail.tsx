import type { IMessage } from '@ant-chat/shared'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@workspace/ui/components/tooltip'
import { cn } from '@workspace/ui/lib/utils'
import { useMemo } from 'react'

interface MessageJumpRailProps {
  /** 所有用户消息（按原始顺序） */
  userMessages: IMessage[]
  /** 当前可见的用户消息 id */
  activeMessageId: string | null
  /** 点击节点时的回调，传入目标消息 id */
  onJumpToMessage: (messageId: string) => void
}

/**
 * 从消息内容中提取摘要文本。
 * - 优先取第一个 text block 的文本
 * - 空内容或只有附件时返回占位文本
 */
function extractSummary(message: IMessage): string {
  if (Array.isArray(message.content)) {
    const firstText = message.content.find(b => b.type === 'text')
    if (firstText && 'text' in firstText && firstText.text.trim()) {
      return firstText.text.trim()
    }
  }

  return 'User message'
}

/**
 * 截断文本到指定长度，超出部分用省略号
 */
function truncateText(text: string, maxLength = 80): string {
  if (text.length <= maxLength)
    return text
  return `${text.slice(0, maxLength)}…`
}

export function MessageJumpRail({
  userMessages,
  activeMessageId,
  onJumpToMessage,
}: MessageJumpRailProps) {
  const summaries = useMemo(
    () => userMessages.map(m => truncateText(extractSummary(m))),
    [userMessages],
  )

  if (userMessages.length <= 1)
    return null

  return (
    <>
      {/* 桌面：右侧垂直 rail */}
      <nav
        aria-label="Message navigation"
        className={`
          fixed top-1/2 right-3 z-20 hidden
          -translate-y-1/2 flex-col items-center gap-1.5 opacity-[0.42]
          transition-opacity duration-200 focus-within:opacity-100
          hover:opacity-100 md:flex
        `}
      >
        {userMessages.map((message, index) => {
          const isActive = message.id === activeMessageId

          return (
            <Tooltip key={message.id}>
              <TooltipTrigger
                delay={300}
                render={(
                  <button
                    type="button"
                    aria-label={`跳转到用户消息 ${index + 1}`}
                    aria-current={isActive ? 'true' : undefined}
                    className={cn(
                      'block rounded-full border transition-colors duration-200',
                      'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                      isActive
                        ? 'size-2 border-primary bg-primary'
                        : [
                            'size-1.5',
                            'border-muted-foreground/30 bg-background',
                            'hover:size-2 hover:border-primary hover:ring-2 hover:ring-primary/20',
                          ],
                    )}
                    onClick={() => onJumpToMessage(message.id)}
                  />
                )}
              />
              <TooltipContent side="left" sideOffset={12}>
                <p className="line-clamp-3 max-w-48 text-xs/relaxed whitespace-pre-wrap">
                  {summaries[index]}
                </p>
              </TooltipContent>
            </Tooltip>
          )
        })}
      </nav>

      {/* 移动端：底部横向小圆点条（无 tooltip） */}
      <nav
        aria-label="Message navigation"
        className={`
          sticky inset-x-0 bottom-0 z-20
          flex items-center justify-center gap-1.5 bg-background/80
          py-1.5 opacity-[0.6] backdrop-blur-sm
          transition-opacity duration-200 focus-within:opacity-100
          hover:opacity-100 md:hidden
        `}
      >
        {userMessages.map((message, index) => {
          const isActive = message.id === activeMessageId

          return (
            <button
              key={message.id}
              type="button"
              aria-label={`跳转到用户消息 ${index + 1}`}
              aria-current={isActive ? 'true' : undefined}
              className={cn(
                'block rounded-full border transition-all duration-200',
                'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                isActive
                  ? 'size-2 border-primary bg-primary'
                  : [
                      'size-1.5',
                      'border-muted-foreground/30 bg-background',
                      'hover:size-2 hover:border-primary hover:ring-2 hover:ring-primary/20',
                    ],
              )}
              onClick={() => onJumpToMessage(message.id)}
            />
          )
        })}
      </nav>
    </>
  )
}
