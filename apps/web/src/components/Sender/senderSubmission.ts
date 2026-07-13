import type { IMessageContent } from '@ant-chat/shared'
import type { FileUIPart } from 'ai'
import { classifyFile } from '@ant-chat/shared'
import { nanoid } from 'nanoid'
import { fileToBase64 } from '@/utils'

interface SenderAttachment {
  uid: string
  name: string
  size: number
  type: string
  data: string
}

export interface SenderPromptMessage {
  text: string
  files: FileUIPart[]
}

async function filePartToAttachment(part: FileUIPart, index: number): Promise<SenderAttachment | null> {
  if (!part.url) {
    return null
  }

  const response = await fetch(part.url)
  const blob = await response.blob()
  const filename = part.filename || `attachment-${index}`
  const file = new File([blob], filename, {
    type: part.mediaType || blob.type || 'application/octet-stream',
  })
  const data = await fileToBase64(file)

  return {
    uid: (part as FileUIPart & { id?: string }).id ?? nanoid(),
    name: filename,
    size: file.size,
    type: file.type || 'application/octet-stream',
    data,
  }
}

export async function buildMessageContent(message: SenderPromptMessage): Promise<IMessageContent> {
  const files = await Promise.all(
    message.files.map((part, index) => filePartToAttachment(part, index)),
  )

  const content: IMessageContent = [
    { type: 'text', text: message.text },
  ]

  files.forEach((file) => {
    if (!file) {
      return
    }

    const category = classifyFile(file.name, file.type)

    if (category === 'image') {
      content.push({
        type: 'image-block',
        source: {
          type: 'file_id',
          file_id: file.uid,
        },
        name: file.name,
        media_type: file.type,
        size: file.size,
        data: file.data,
      })
    }
    else if (category === 'document') {
      content.push({
        type: 'document',
        source: {
          type: 'file_id',
          file_id: file.uid,
        },
        name: file.name,
        media_type: file.type,
        size: file.size,
        data: file.data,
      })
    }
    else {
      content.push({
        type: 'file',
        source: {
          type: 'file_id',
          file_id: file.uid,
        },
        filename: file.name,
        name: file.name,
        media_type: file.type,
        size: file.size,
        data: file.data,
      })
    }
  })

  return content
}
