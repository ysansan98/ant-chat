import type { IMessage } from '@ant-chat/shared'

/**
 * 将消息内容转换为字符串格式
 */
export function transformMessageContent(message: IMessage): string {
  if (typeof message.content === 'string') {
    return message.content
  }

  return message.content.reduce((acc, block, index) => {
    if (block.type === 'image') {
      return block?.url
        ? `\n![](${block.url})`
        : `${acc}\n![](data:${block.mimeType};base64,${block.data})\n`
    }
    else if (block.type === 'error') {
      return index === 0 ? `${acc}\n${block.error}` : `${acc}\n> [!CAUTION]\n> ${block.error}`
    }
    else {
      return `${acc}\n${block.text}`
    }
  }, '')
}
