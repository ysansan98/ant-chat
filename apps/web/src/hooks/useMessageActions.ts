import type { IMessage } from '@ant-chat/shared'
import { useCallback } from 'react'
import { toast } from 'sonner'
import { clipboardWrite } from '@/utils'
import { transformMessageContent } from '@/utils/messageTransform'

export function useMessageActions() {
  const copyMessage = useCallback(async (message: IMessage) => {
    // 与气泡展示共用同一套内容转文本逻辑，批注/附件/工具块的文案保持一致
    const data = { text: transformMessageContent(message), html: '' }

    try {
      await clipboardWrite(data)
      toast.success('复制成功')
    }
    catch {
      toast.error('复制失败')
    }
  }, [])

  return {
    copyMessage,
  }
}
