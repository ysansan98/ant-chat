import type { WorkspaceFileKind } from '@ant-chat/shared'

/** markdown 文件（支持 Preview/Source 双模式）判断 */
export function isMarkdownFileName(name: string): boolean {
  const base = name.toLowerCase()
  return base.endsWith('.md') || base.endsWith('.markdown')
}

const EXTENSION_KINDS: Record<string, WorkspaceFileKind> = {
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.gif': 'image',
  '.webp': 'image',
  '.bmp': 'image',
  '.svg': 'image',
  '.ico': 'image',
  '.avif': 'image',
  '.mp3': 'audio',
  '.wav': 'audio',
  '.ogg': 'audio',
  '.m4a': 'audio',
  '.flac': 'audio',
  '.aac': 'audio',
  '.mp4': 'video',
  '.webm': 'video',
  '.mov': 'video',
  '.avi': 'video',
  '.mkv': 'video',
  '.xlsx': 'excel',
  '.xls': 'excel',
  '.pdf': 'pdf',
  '.docx': 'docx',
}

/**
 * 根据文件名推断预览类型，决定前端分发到哪种预览组件。
 * markdown 优先于 text（支持 Preview/Source 双模式）；未知扩展名回退 text（代码高亮）。
 */
export function detectFileKind(name: string): WorkspaceFileKind {
  if (isMarkdownFileName(name)) {
    return 'markdown'
  }
  const baseName = name.split('/').pop() ?? name
  const dotIndex = baseName.lastIndexOf('.')
  if (dotIndex <= 0) {
    return 'text'
  }
  return EXTENSION_KINDS[baseName.slice(dotIndex).toLowerCase()] ?? 'text'
}
