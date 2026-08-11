import type { IAttachment, IMessage, IMessageContent } from '@ant-chat/shared'

interface BlockWithData {
  type: string
  source: { type: string, file_id: string }
  name?: string
  filename?: string
  media_type?: string
  mimeType?: string
  size?: number
  data?: string
}

/**
 * 从 IMessage.content 中提取图片内容块，转换为 IAttachment[]
 */
function extractImageBlocks(content: IMessageContent): IAttachment[] {
  return content
    .filter((b): b is BlockWithData & typeof b => b.type === 'image' && 'source' in b)
    .map((b, i) => {
      const data = b.data || ''
      return {
        uid: b.source?.type === 'file_id' ? b.source.file_id : `image-${i}`,
        name: b.name || 'Image',
        size: b.size ?? 0,
        type: b.mimeType || 'image/png',
        data,
      }
    })
}

/**
 * 从 IMessage.content 中提取 document/file 内容块，转换为 IAttachment[]
 */
function extractAttachmentBlocks(content: IMessageContent): IAttachment[] {
  return content
    .filter((b): b is BlockWithData & typeof b =>
      (b.type === 'document' || b.type === 'file') && 'source' in b,
    )
    .map((b, i) => ({
      uid: b.source?.type === 'file_id' ? b.source.file_id : `attach-${i}`,
      name: b.name || b.filename || 'File',
      size: b.size ?? 0,
      type: b.media_type || 'application/octet-stream',
      data: b.data || '',
    }))
}

/**
 * 从用户消息中提取 images 和 attachments 数据
 */
export function extractMessageAttachments(message: IMessage): {
  images: IAttachment[]
  attachments: IAttachment[]
} {
  const content = Array.isArray(message.content) ? message.content : []
  return {
    images: extractImageBlocks(content),
    attachments: extractAttachmentBlocks(content),
  }
}
