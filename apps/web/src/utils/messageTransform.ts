import type { IMessage } from '@ant-chat/shared'

/**
 * 将消息内容转换为字符串格式
 */
export function transformMessageContent(message: IMessage): string {
  if (typeof message.content === 'string') {
    return message.content
  }

  return message.content.reduce((acc, block) => {
    const prefix = acc ? '\n' : ''

    if (block.type === 'image') {
      return block?.url
        ? `${acc}${prefix}![](${block.url})`
        : `${acc}${prefix}![](data:${block.mimeType};base64,${block.data})`
    }
    else if (block.type === 'error') {
      return acc ? `${acc}\n> [!CAUTION]\n> ${block.error}` : block.error
    }
    else if (block.type === 'tool-call') {
      return `${acc}${prefix}[Tool: ${block.toolName}(${JSON.stringify(block.args)})]`
    }
    else if (block.type === 'tool-result') {
      const label = block.isError ? 'Error' : 'Result'
      return `${acc}${prefix}[${label}: ${block.toolName}]`
    }
    else {
      return `${acc}${prefix}${block.text}`
    }
  }, '')
}
