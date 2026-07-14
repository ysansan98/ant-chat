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
      return acc ? `${acc}\n${block.error}` : block.error
    }
    else if (block.type === 'tool-call') {
      return `${acc}${prefix}[Tool: ${block.toolName}(${JSON.stringify(block.args)})]`
    }
    else if (block.type === 'tool-result') {
      const label = block.isError ? 'Error' : 'Result'
      return `${acc}${prefix}[${label}: ${block.toolName}]`
    }
    else if (block.type === 'image-block') {
      return `${acc}${prefix}[Image: ${block.name || 'image'}]`
    }
    else if (block.type === 'document') {
      return `${acc}${prefix}[Document: ${block.name || block.title || 'document'}]`
    }
    else if (block.type === 'file') {
      return `${acc}${prefix}[File: ${block.filename || block.name || 'file'}]`
    }
    else if (block.type === 'visualization') {
      return `${acc}${prefix}[可视化：${block.title}]`
    }
    else {
      return `${acc}${prefix}${block.text}`
    }
  }, '')
}
