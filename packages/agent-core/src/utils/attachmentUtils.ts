import type { IAttachment, LoopMessage } from '@ant-chat/shared'
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
