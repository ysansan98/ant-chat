import type { IMessage } from '@ant-chat/shared'

const COMPACTION_MARKER = '__COMPACTION__'

export interface CompactionMarker {
  isCompaction: true
  summary: string
}

/**
 * 检测消息是否为压缩标记，并提取摘要内容。
 */
export function detectCompactionMarker(message: IMessage): CompactionMarker | null {
  const content = getRawContent(message)
  if (!content.startsWith(COMPACTION_MARKER)) {
    return null
  }
  const summary = content.slice(COMPACTION_MARKER.length).trim()
  return { isCompaction: true, summary: summary || '上下文压缩完成' }
}

function getRawContent(message: IMessage): string {
  if (typeof message.content === 'string') {
    return message.content
  }
  return message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

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
