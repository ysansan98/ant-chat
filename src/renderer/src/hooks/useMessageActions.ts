import type { IMessage } from '@ant-chat/shared'
import { App } from 'antd'
import { useCallback } from 'react'
import { deleteMessageAction } from '@/store/messages'
import { clipboardWrite } from '@/utils'

export function useMessageActions() {
  const { message: messageFunc } = App.useApp()

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
      messageFunc.success('复制成功')
    }
    catch {
      messageFunc.error('复制失败')
    }
  }, [messageFunc])

  const deleteMessage = useCallback(async (messageId: string) => {
    await deleteMessageAction(messageId)
  }, [])

  return {
    copyMessage,
    deleteMessage,
  }
}
