import type { IAttachment, IMessage } from '@ant-chat/shared'

/** 单个 content 块转换出的附件条目（kind 决定渲染通道：图片走 ImageViewer，其余走文件卡片）。 */
export interface AttachmentItem {
  kind: 'image' | 'document' | 'file'
  item: IAttachment
}

interface BlockWithSource {
  type: string
  source: { type: string, file_id: string }
  name?: string
  filename?: string
  media_type?: string
  mimeType?: string
  size?: number
  data?: string
}

function isBlockWithSource(value: unknown): value is BlockWithSource {
  return Boolean(value) && typeof value === 'object' && 'source' in (value as object)
}

/**
 * 单个 content 块 → 附件条目；文本、工具调用、可视化等非附件块返回 null。
 * 与持久化形态对齐：file_id 提供附件标识，data 仅在 transport 形态携带（持久化后被剥离）。
 */
export function attachmentBlockToItem(block: unknown, index = 0): AttachmentItem | null {
  if (!isBlockWithSource(block)) {
    return null
  }

  if (block.type === 'image') {
    return {
      kind: 'image',
      item: {
        uid: block.source?.type === 'file_id' ? block.source.file_id : `image-${index}`,
        name: block.name || 'Image',
        size: block.size ?? 0,
        type: block.mimeType || 'image/png',
        data: block.data || '',
      },
    }
  }

  if (block.type === 'document' || block.type === 'file') {
    return {
      kind: block.type,
      item: {
        uid: block.source?.type === 'file_id' ? block.source.file_id : `attach-${index}`,
        name: block.name || block.filename || 'File',
        size: block.size ?? 0,
        type: block.media_type || 'application/octet-stream',
        data: block.data || '',
      },
    }
  }

  return null
}

/**
 * 从 IMessage.content 中提取图片与文件内容块，转换为 IAttachment[]
 */
export function extractMessageAttachments(message: IMessage): {
  images: IAttachment[]
  attachments: IAttachment[]
} {
  const content = Array.isArray(message.content) ? message.content : []
  const images: IAttachment[] = []
  const attachments: IAttachment[] = []
  content.forEach((block, index) => {
    const converted = attachmentBlockToItem(block, index)
    if (!converted) {
      return
    }
    if (converted.kind === 'image') {
      images.push(converted.item)
    }
    else {
      attachments.push(converted.item)
    }
  })
  return { images, attachments }
}
