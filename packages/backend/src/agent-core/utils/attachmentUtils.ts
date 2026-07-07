import type { IMessageContent, LoadFileDataFn, LoopMessage } from '@ant-chat/shared'

export async function contentBlocksToLoopMessageContent(
  content: IMessageContent,
  loadFileData?: LoadFileDataFn,
): Promise<LoopMessage['content']> {
  const result: LoopMessage['content'] = []

  for (const block of content) {
    switch (block.type) {
      case 'text':
        result.push({ type: 'text', text: block.text })
        break

      case 'image':
        if (block.data) {
          result.push({
            type: 'image',
            mimeType: block.mimeType || 'image/jpeg',
            data: block.data,
          })
        }
        break

      case 'image-block':
        if (block.source.type === 'file_id') {
          const data = getBase64Payload(block.data) ?? (loadFileData ? await loadFileData(block.source.file_id) : null)
          if (data) {
            result.push({
              type: 'image',
              mimeType: block.media_type || 'image/jpeg',
              data,
            })
          }
        }
        break

      case 'document':
        if (block.source.type === 'file_id') {
          const data = getBase64Payload(block.data) ?? (loadFileData ? await loadFileData(block.source.file_id) : null)
          if (data) {
            result.push({
              type: 'file',
              mimeType: block.media_type || 'application/octet-stream',
              data,
            })
          }
        }
        break

      case 'file':
        if (block.source.type === 'file_id') {
          const data = getBase64Payload(block.data) ?? (loadFileData ? await loadFileData(block.source.file_id) : null)
          if (data) {
            result.push({
              type: 'file',
              mimeType: block.media_type || 'application/octet-stream',
              data,
            })
          }
        }
        break

      case 'error':
        result.push({ type: 'text', text: `Error: ${block.error}` })
        break

      case 'tool-call':
        result.push(block)
        break

      case 'tool-result':
        result.push(block)
        break
    }
  }

  return result
}

function getBase64Payload(data?: string): string | null {
  if (!data) {
    return null
  }

  const commaIndex = data.indexOf(',')
  return data.startsWith('data:') && commaIndex !== -1
    ? data.slice(commaIndex + 1)
    : data
}
