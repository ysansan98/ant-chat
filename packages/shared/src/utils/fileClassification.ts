/**
 * 文件分类工具函数
 * 根据 MIME 类型判断文件属于 image、document 还是 file
 */

export type FileCategory = 'image' | 'document' | 'file'

/**
 * 加载文件数据的回调函数类型
 * 用于将 file_id 转换为 base64 数据
 */
export type LoadFileDataFn = (fileId: string) => Promise<string | null>

/**
 * 根据 MIME 类型判断文件分类
 * @param mimeType 文件的 MIME 类型
 * @returns 文件分类：'image' | 'document' | 'file'
 */
export function classifyFileByMimeType(mimeType: string): FileCategory {
  if (mimeType.startsWith('image/')) {
    return 'image'
  }

  const isDocument = mimeType.startsWith('text/')
    || mimeType.includes('pdf')
    || mimeType.includes('document')
    || mimeType.includes('spreadsheet')
    || mimeType.includes('presentation')
    || mimeType.includes('msword')
    || mimeType.includes('ms-excel')
    || mimeType.includes('ms-powerpoint')
    || mimeType.includes('opendocument')
    || mimeType.includes('openxmlformats')

  if (isDocument) {
    return 'document'
  }

  return 'file'
}

/**
 * 根据文件名和 MIME 类型判断文件分类
 * @param fileName 文件名
 * @param mimeType 文件的 MIME 类型
 * @returns 文件分类：'image' | 'document' | 'file'
 */
export function classifyFile(fileName: string, mimeType: string): FileCategory {
  // 优先根据 MIME 类型判断
  const category = classifyFileByMimeType(mimeType)
  if (category !== 'file') {
    return category
  }

  // 如果 MIME 类型判断为 file，再根据文件扩展名判断
  const ext = fileName.includes('.') ? `.${fileName.split('.').pop()!.toLowerCase()}` : ''
  const documentExtensions = new Set([
    '.txt',
    '.md',
    '.markdown',
    '.rst',
    '.org',
    '.pdf',
    '.doc',
    '.docx',
    '.xls',
    '.xlsx',
    '.ppt',
    '.pptx',
    '.odt',
    '.ods',
    '.odp',
    '.rtf',
    '.csv',
    '.tsv',
    '.json',
    '.xml',
    '.yaml',
    '.yml',
    '.toml',
    '.html',
    '.htm',
    '.css',
    '.scss',
    '.less',
    '.js',
    '.jsx',
    '.ts',
    '.tsx',
    '.mjs',
    '.cjs',
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
    '.sql',
    '.graphql',
    '.proto',
  ])

  if (documentExtensions.has(ext)) {
    return 'document'
  }

  return 'file'
}
