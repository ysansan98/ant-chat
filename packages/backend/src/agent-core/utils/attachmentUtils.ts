import type { IMessageContent, LoadFileDataFn, LoopMessage } from '@ant-chat/shared'
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

/**
 * 将新的 content blocks 格式转换为 LoopMessage['content'] 格式
 * 注意：对于 file_id 类型，需要先加载文件数据
 * 这个函数假设文件数据已经加载到 content blocks 中
 */
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
              type: 'text',
              text: formatAttachedFileText({
                data,
                mediaType: block.media_type,
                name: block.name || 'document',
                tagName: 'document',
              }),
            })
          }
        }
        break

      case 'file':
        if (block.source.type === 'file_id') {
          const data = getBase64Payload(block.data) ?? (loadFileData ? await loadFileData(block.source.file_id) : null)
          if (data) {
            result.push({
              type: 'text',
              text: formatAttachedFileText({
                data,
                mediaType: block.media_type,
                name: block.filename || block.name || 'file',
                tagName: 'file',
              }),
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

function formatAttachedFileText(input: {
  data: string
  mediaType?: string
  name: string
  tagName: 'document' | 'file'
}): string {
  const type = input.mediaType || 'application/octet-stream'
  if (!isTextAttachment(type, input.name)) {
    return `[Attached ${input.tagName}: ${input.name} (${type})]`
  }

  const decoded = Buffer.from(input.data, 'base64').toString('utf-8')
  return `<${input.tagName} name="${input.name}" type="${type}">\n${decoded}\n</${input.tagName}>`
}
