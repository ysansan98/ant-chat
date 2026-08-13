import type { IMessage } from '@ant-chat/shared'
import { toImageDataUrl } from '@/utils/file'

export interface MessageTransformOptions {
  /**
   * 跳过有独立渲染通道的附件块（image/document/file）。
   * 用户气泡内只渲染文本时启用；占位文本仍保留给复制、TurnTrace 等无渲染通道的场景。
   */
  skipAttachmentBlocks?: boolean
}

/**
 * 将消息内容转换为字符串格式
 */
export function transformMessageContent(
  message: IMessage,
  options: MessageTransformOptions = {},
): string {
  if (typeof message.content === 'string') {
    return message.content
  }

  const { skipAttachmentBlocks = false } = options

  return message.content.reduce((acc, block) => {
    if (
      skipAttachmentBlocks
      && (block.type === 'image' || block.type === 'document' || block.type === 'file')
    ) {
      return acc
    }

    const prefix = acc ? '\n' : ''

    if (block.type === 'image') {
      if (block.url)
        return `${acc}${prefix}![](${block.url})`
      if (block.data)
        return `${acc}${prefix}![](${toImageDataUrl(block.data, block.mimeType)})`
      return `${acc}${prefix}[Image: ${block.name || 'image'}]`
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
    else if (block.type === 'document') {
      return `${acc}${prefix}[Document: ${block.name || block.title || 'document'}]`
    }
    else if (block.type === 'file') {
      return `${acc}${prefix}[File: ${block.filename || block.name || 'file'}]`
    }
    else if (block.type === 'visualization') {
      return `${acc}${prefix}[可视化：${block.title}]`
    }
    else if (block.type === 'annotation') {
      const comment = block.comment ? `\n评论：${block.comment}` : ''
      return `${acc}${prefix}引用：${block.quote}${comment}`
    }
    else {
      return `${acc}${prefix}${block.text}`
    }
  }, '')
}
