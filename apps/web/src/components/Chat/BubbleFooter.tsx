import type { IMessage, IModelInfo } from '@ant-chat/shared'
import {
  MessageAction,
  MessageActions,
} from '@workspace/ui/components/ai-elements/message'
import { Badge } from '@workspace/ui/components/badge'
import { ClockIcon, CopyIcon } from 'lucide-react'
import { useEffect, useMemo, useReducer, useRef } from 'react'
import { formatDuration, formatTime } from '@/utils'

interface BubbleFooterProps {
  message: IMessage
  onCopy?: (message: IMessage) => void
  time?: number
  modelInfo?: IModelInfo
  durationMs?: number
}

const LIVE_TICK_MS = 200

export default function BubbleFooter({ message, onCopy, time, modelInfo, durationMs }: BubbleFooterProps) {
  const isRunning = message.status === 'loading' || message.status === 'typing'
  const startRef = useRef(message.createdAt)
  const [elapsedMs, dispatchElapsed] = useReducer((_prev: number, action: number) => action, 0)

  useEffect(() => {
    if (!isRunning || durationMs != null)
      return

    startRef.current = message.createdAt
    dispatchElapsed(Date.now() - startRef.current)

    let frameId: number
    let lastTick = 0
    const animate = (time: number) => {
      if (time - lastTick >= LIVE_TICK_MS) {
        lastTick = time
        dispatchElapsed(Date.now() - startRef.current)
      }
      frameId = requestAnimationFrame(animate)
    }
    frameId = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(frameId)
  }, [isRunning, durationMs, message.createdAt])

  const displayMs = durationMs ?? (isRunning ? elapsedMs : undefined)

  const copyButton = useMemo(() => (
    <MessageAction
      tooltip="Copy"
      label="Copy"
      onClick={() => {
        onCopy?.(message)
      }}
    >
      <CopyIcon className="size-4" />
    </MessageAction>
  ), [onCopy, message])

  return (
    <MessageActions
      className="
        mt-2 opacity-0 transition-opacity duration-200
        group-hover/message:opacity-100 text-xs
      "
    >
      <span>{copyButton}</span>

      {
        modelInfo && (
          <>
            <Badge variant="outline">{modelInfo.provider}</Badge>
            <Badge variant="secondary">{modelInfo.model}</Badge>
          </>
        )
      }
      {
        displayMs != null && (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <ClockIcon className="size-3" />
            耗时
            {formatDuration(displayMs)}
          </span>
        )
      }
      <span className="ml-auto">
        {time ? formatTime(time) : ''}
      </span>
    </MessageActions>
  )
}
