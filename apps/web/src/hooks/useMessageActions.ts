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
      else if (b.type === 'image-block') {
        data.text += `[Image: ${b.name || 'image'}]`
      }
      else if (b.type === 'document') {
        data.text += `[Document: ${b.name || b.title || 'document'}]`
      }
      else if (b.type === 'file') {
        data.text += `[File: ${b.filename || b.name || 'file'}]`
      }
      else if (b.type === 'error') {
        data.text += `${b.error}`
      }
      else if (b.type === 'tool-call') {
        data.text += `[Tool: ${b.toolName}]`
      }
      else if (b.type === 'tool-result') {
        data.text += `[Result: ${b.toolName}]`
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
