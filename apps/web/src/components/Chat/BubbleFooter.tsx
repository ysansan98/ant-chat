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
  startedAt?: number
  running?: boolean
}

const LIVE_TICK_MS = 200

export default function BubbleFooter({ message, onCopy, time, modelInfo, durationMs, startedAt = message.createdAt, running }: BubbleFooterProps) {
  const isRunning = running ?? (message.status === 'loading' || message.status === 'typing')
  const startRef = useRef(startedAt)
  const [elapsedMs, dispatchElapsed] = useReducer(
    (_prev: number, action: number) => action,
    Math.max(0, Date.now() - startedAt),
  )

  useEffect(() => {
    if (!isRunning || durationMs != null)
      return

    startRef.current = startedAt
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
  }, [isRunning, durationMs, startedAt])

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
          <span className="inline-flex items-center gap-1 text-muted-foreground tabular-nums">
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
