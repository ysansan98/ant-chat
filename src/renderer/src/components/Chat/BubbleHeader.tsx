import type { IModelInfo } from '@ant-chat/shared'
import { Tag } from 'antd'
import { formatTime } from '@/utils'

interface BubbleHeaderProps {
  time?: number
  modelInfo?: IModelInfo
}

export function BubbleHeader({ time, modelInfo }: BubbleHeaderProps) {
  return (
    <div className="flex items-center text-xs">
      <div className="mr-2">
        {time ? formatTime(time) : ''}
      </div>
      {
        modelInfo && (
          <>
            <Tag color="lime">{modelInfo.provider}</Tag>
            <Tag color="green">{modelInfo.model}</Tag>
          </>
        )
      }
    </div>
  )
}
