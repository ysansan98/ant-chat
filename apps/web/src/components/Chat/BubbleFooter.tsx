import type { IMessage, IModelInfo } from '@ant-chat/shared'
import {
  MessageAction,
  MessageActions,
} from '@workspace/ui/components/ai-elements/message'
import { Badge } from '@workspace/ui/components/badge'
import { ClockIcon, CopyIcon } from 'lucide-react'
import { useMemo } from 'react'
import { formatDuration, formatTime } from '@/utils'

interface BubbleFooterProps {
  message: IMessage
  onCopy?: (message: IMessage) => void
  time?: number
  modelInfo?: IModelInfo
  durationMs?: number
}

export default function BubbleFooter({ message, onCopy, time, modelInfo, durationMs }: BubbleFooterProps) {
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
        group-hover:opacity-100 text-xs
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
      <span>
        {time ? formatTime(time) : ''}
      </span>
      {
        durationMs != null && (
          <span className="ml-auto inline-flex items-center gap-1 text-muted-foreground">
            <ClockIcon className="size-3" />
            {formatDuration(durationMs)}
          </span>
        )
      }
    </MessageActions>
  )
}
