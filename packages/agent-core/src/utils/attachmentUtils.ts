import type { IAttachment, IMessageContent, LoopMessage } from '@ant-chat/shared'
import { Buffer } from 'node:buffer'

const TEXT_MIME_PREFIXES = ['text/', 'application/json', 'application/xml', 'application/javascript', 'application/typescript', 'application/x-yaml', 'application/yaml', 'application/toml']
const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.mts',
  '.cts',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.xml',
  '.csv',
  '.md',
  '.txt',
  '.rst',
  '.log',
  '.ini',
  '.cfg',
  '.conf',
  '.py',
  '.rb',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.swift',
  '.c',
  '.cpp',
  '.h',
  '.hpp',
  '.sh',
  '.bash',
  '.zsh',
  '.fish',
  '.ps1',
  '.bat',
  '.cmd',
  '.html',
  '.css',
  '.scss',
  '.less',
  '.vue',
  '.svelte',
  '.sql',
  '.graphql',
  '.proto',
  '.env',
  '.gitignore',
  '.dockerignore',
  '.editorconfig',
  '.dockerfile',
  '.makefile',
])

export function isTextAttachment(mimeType: string, fileName?: string): boolean {
  if (TEXT_MIME_PREFIXES.some(prefix => mimeType.startsWith(prefix))) {
    return true
  }
  if (fileName) {
    const ext = fileName.includes('.') ? `.${fileName.split('.').pop()!.toLowerCase()}` : ''
    if (TEXT_EXTENSIONS.has(ext))
      return true
    if (fileName === 'Dockerfile' || fileName === 'Makefile' || fileName === 'Gemfile' || fileName === 'Rakefile')
      return true
  }
  return false
}

export function attachmentsToContentBlocks(attachments: IAttachment[]): LoopMessage['content'] {
  const blocks: LoopMessage['content'] = []
  for (const attachment of attachments) {
    if (isTextAttachment(attachment.type, attachment.name)) {
      const decoded = Buffer.from(attachment.data, 'base64').toString('utf-8')
      blocks.push({ type: 'text', text: `<attached_file name="${attachment.name}">\n${decoded}\n</attached_file>` })
    }
  }
  return blocks
}

export function imagesToContentBlocks(images: IAttachment[]): LoopMessage['content'] {
  return images.map(image => ({
    type: 'image' as const,
    mimeType: image.type,
    data: image.data,
  }))
}

/**
 * 将新的 content blocks 格式转换为 LoopMessage['content'] 格式
 * 注意：对于 file_id 类型，需要先加载文件数据
 * 这个函数假设文件数据已经加载到 content blocks 中
 */
export type LoadFileDataFn = (fileId: string) => Promise<string | null>

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
        // 原有的 image 类型（URL 图片）
        if (block.url) {
          result.push({
            type: 'image',
            mimeType: block.mimeType || 'image/jpeg',
            data: block.data,
          })
        }
        break

      case 'image-block':
        // 新增的图片块
        if (block.source.type === 'file_id' && loadFileData) {
          const data = await loadFileData(block.source.file_id)
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
        // 文档块
        if (block.source.type === 'file_id' && loadFileData) {
          const data = await loadFileData(block.source.file_id)
          if (data) {
            result.push({
              type: 'text',
              text: `<document name="${block.name || 'document'}" type="${block.media_type}">\n${data}\n</document>`,
            })
          }
        }
        break

      case 'file':
        // 文件块
        if (block.source.type === 'file_id' && loadFileData) {
          const data = await loadFileData(block.source.file_id)
          if (data) {
            result.push({
              type: 'text',
              text: `<file name="${block.filename || block.name || 'file'}" type="${block.media_type}">\n${data}\n</file>`,
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
