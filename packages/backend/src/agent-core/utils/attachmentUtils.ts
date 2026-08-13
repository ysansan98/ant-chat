import type { ImageContent, IMessageContent, LoadFileDataFn, LoopMessage } from '@ant-chat/shared'

export interface ImagePlaceholderItem {
  fileId: string
  name?: string
  mimeType?: string
}

type FileIdImageContent = ImageContent & { source: { type: 'file_id', file_id: string } }

export interface AttachmentContentOptions {
  /**
   * 目标模型不支持图片输入时，把图片附件替换成占位符文本：
   * 汇总为紧凑列表（含 file_id），由 agent 调用 `ant-chat image recognize --file-id` 识别，
   * 避免把 image part 直接发给纯文本模型导致上游 400。
   */
  imageToPlaceholder?: {
    /** 收集被替换的图片附件，用于可观测性记录。 */
    onReplaced?: (items: ImagePlaceholderItem[]) => void
  }
}

export async function contentBlocksToLoopMessageContent(
  content: IMessageContent,
  loadFileData?: LoadFileDataFn,
  options?: AttachmentContentOptions,
): Promise<LoopMessage['content']> {
  const result: LoopMessage['content'] = []
  const placeholder = options?.imageToPlaceholder
  // 占位模式：先收集所有 file_id 型图片附件，在首个图片块处合并成一个汇总列表。
  const imageBlocks = placeholder
    ? content.filter((block): block is FileIdImageContent =>
        block.type === 'image' && block.source?.type === 'file_id')
    : []
  let placeholderEmitted = false

  for (const block of content) {
    switch (block.type) {
      case 'text':
        result.push({ type: 'text', text: block.text })
        break

      case 'annotation':
        // 批注块渲染为「引用原文 + 评论」的结构化文本，让模型能区分引用的内容与用户的新评论
        result.push({
          type: 'text',
          text: [
            '<annotation>',
            '<quote>',
            block.quote,
            '</quote>',
            block.comment ? `<comment>\n${block.comment}\n</comment>` : '',
            '</annotation>',
          ].filter(Boolean).join('\n'),
        })
        break

      case 'image': {
        if (placeholder && imageBlocks.length > 0) {
          if (!placeholderEmitted) {
            const items: ImagePlaceholderItem[] = imageBlocks.map(item => ({
              fileId: item.source.file_id,
              name: item.name,
              mimeType: item.mimeType,
            }))
            placeholder.onReplaced?.(items)
            result.push({ type: 'text', text: buildImageListPlaceholder(items) })
            placeholderEmitted = true
          }
          break
        }
        const data = getBase64Payload(block.data)
          ?? (block.source?.type === 'file_id' && loadFileData ? await loadFileData(block.source.file_id) : null)
        if (data) {
          result.push({
            type: 'image',
            mimeType: block.mimeType || 'image/jpeg',
            data,
          })
        }
        break
      }

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

function buildImageListPlaceholder(items: ImagePlaceholderItem[]): string {
  const list = items
    .map((item, index) => `${index + 1}) ${item.name || 'image'} file_id=${item.fileId}`)
    .join(' ')
  const count = items.length
  return [
    `[用户上传了 ${count} 张图片：${list}。`,
    '当前模型不支持直接查看图片，',
    `请用图像识别命令逐张识别（如 \`ant-chat image recognize --file-id ${items[0]?.fileId} --json\`），`,
    '识别是同步模型调用，执行时给 execute_command 设置 timeoutMs: 150000（默认 10 秒超时不够）。',
    '再结合识别结果回答用户。]',
  ].join('')
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
