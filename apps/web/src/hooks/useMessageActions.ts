import type { IMessage } from '@ant-chat/shared'
import { useCallback } from 'react'
import { toast } from 'sonner'
import { clipboardWrite } from '@/utils'

export function useMessageActions() {
  const copyMessage = useCallback(async (message: IMessage) => {
    const data = { text: '', html: '' }
    message.content.forEach((b, index) => {
      if (index !== 0) {
        data.text += '\n'
      }
      if (b.type === 'image') {
        data.text += `![](data:${b.mimeType};base64,${b.data})\n`
      }
      else if (b.type === 'error') {
        data.text += `> [!CAUTION]\n> ${b.error}`
      }
      else {
        data.text += `${b.text}`
      }
    })

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
