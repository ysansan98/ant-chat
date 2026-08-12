import type { WorkspaceDirectoryEntries, WorkspaceFileStreamInfo, WorkspaceTextFileContent, WorkspaceTreeEntry } from '@ant-chat/shared'
import fs from 'node:fs'
import path from 'node:path'

/** 单目录枚举上限：避免一次性返回超大目录（如 node_modules 根）的全部条目 */
const MAX_ENTRIES_PER_DIRECTORY = 2000
/** 文本预览最大字节数（1MB） */
const MAX_PREVIEW_BYTES = 1024 * 1024
/** 二进制探测字节数：仅读取文件头，避免为判定读入整个文件 */
const BINARY_SNIFF_BYTES = 8 * 1024

const PATH_OUTSIDE_WORKSPACE = '路径超出工作区范围'

/**
 * 校验 relPath 是否为合法的相对 posix 路径：
 * 拒绝绝对路径、盘符前缀、反斜杠与 `..` 段（防止向上遍历越界）。
 */
function isValidRelativePath(relPath: string | undefined): boolean {
  if (relPath === undefined || relPath === '') {
    return true
  }
  if (
    relPath.startsWith('/')
    || /^[A-Z]:/i.test(relPath)
    || relPath.includes('\\')
  ) {
    return false
  }
  return !relPath.split('/').includes('..')
}

/**
 * 将相对路径解析为工作区内的真实路径。
 * 通过 realpath 做包含性校验，阻断符号链接逃逸到工作区外。
 */
function resolveInsideWorkspace(root: string, relPath: string | undefined): string {
  const rootReal = fs.realpathSync.native(root)
  const candidate = relPath ? path.resolve(root, relPath) : root
  let real: string
  try {
    real = fs.realpathSync.native(candidate)
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`文件不存在：${relPath ?? ''}`)
    }
    throw error
  }
  if (real !== rootReal && !real.startsWith(`${rootReal}${path.sep}`)) {
    throw new Error(PATH_OUTSIDE_WORKSPACE)
  }
  return real
}

/** 计算绝对路径相对工作区根（真实路径）的 posix 相对路径 */
function relPathOf(rootReal: string, absolutePath: string): string {
  return path.relative(rootReal, absolutePath).split(path.sep).join('/')
}

/**
 * 解析工作区内的真实绝对路径（含符号链接逃逸校验）。
 * 供「用默认软件打开文件」等需要真实路径的宿主操作复用。
 */
export function resolveWorkspaceFilePath(workspacePath: string, relPath: string): string {
  if (!isValidRelativePath(relPath)) {
    throw new Error(PATH_OUTSIDE_WORKSPACE)
  }
  const root = path.resolve(workspacePath)
  return resolveInsideWorkspace(root, relPath)
}

/** 扩展名（小写含点）→ MIME 类型；未命中回退 application/octet-stream。 */
const EXTENSION_MEDIA_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

/** 根据文件名推断 MIME 类型，未知时回退 application/octet-stream。 */
function detectMediaType(fileName: string): string {
  const baseName = fileName.split('/').pop() ?? fileName
  const dotIndex = baseName.lastIndexOf('.')
  if (dotIndex <= 0) {
    return 'application/octet-stream'
  }
  return EXTENSION_MEDIA_TYPES[baseName.slice(dotIndex).toLowerCase()] ?? 'application/octet-stream'
}

/**
 * 解析工作区内文件的流式预览元信息：复用路径安全校验（防遍历/符号链接逃逸），
 * 返回真实绝对路径、文件大小与 MIME 类型。仅做路径与 stat 解析，不读取文件内容，
 * 供 HTTP 端点 / Electron protocol 流式传输使用。
 */
export async function getWorkspaceFileForStream(
  workspacePath: string,
  relPath: string,
): Promise<WorkspaceFileStreamInfo> {
  if (!isValidRelativePath(relPath) || !relPath) {
    throw new Error(PATH_OUTSIDE_WORKSPACE)
  }

  const root = path.resolve(workspacePath)
  const target = resolveInsideWorkspace(root, relPath)

  let stat: fs.Stats
  try {
    stat = await fs.promises.stat(target)
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`文件不存在：${relPath}`)
    }
    throw new Error(`无法读取文件：${error instanceof Error ? error.message : String(error)}`)
  }
  if (!stat.isFile()) {
    throw new Error('路径不是文件')
  }

  return {
    absolutePath: target,
    size: stat.size,
    mediaType: detectMediaType(relPath),
  }
}

function sortEntries(entries: WorkspaceTreeEntry[]): void {
  entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))
}

/**
 * 列出工作区内单个目录的直接子条目（懒加载文件树的数据来源）。
 * 目录在前、文件在后，各自按名称排序；符号链接解析后逃逸工作区的条目被剔除。
 */
export async function listDirectoryEntries(
  workspacePath: string,
  relPath?: string,
): Promise<WorkspaceDirectoryEntries> {
  if (!isValidRelativePath(relPath)) {
    throw new Error(PATH_OUTSIDE_WORKSPACE)
  }

  const root = path.resolve(workspacePath)
  const rootReal = fs.realpathSync.native(root)
  const target = resolveInsideWorkspace(root, relPath)

  let stat: fs.Stats
  try {
    stat = await fs.promises.stat(target)
  }
  catch {
    throw new Error(`目录不存在：${relPath ?? ''}`)
  }
  if (!stat.isDirectory()) {
    throw new Error('路径不是目录')
  }

  let entries: fs.Dirent[]
  try {
    entries = await fs.promises.readdir(target, { withFileTypes: true })
  }
  catch (error) {
    throw new Error(`无法读取目录：${error instanceof Error ? error.message : String(error)}`)
  }

  const dirs: WorkspaceTreeEntry[] = []
  const files: WorkspaceTreeEntry[] = []

  for (const entry of entries) {
    if (dirs.length + files.length >= MAX_ENTRIES_PER_DIRECTORY) {
      break
    }
    if (!entry.isFile() && !entry.isDirectory() && !entry.isSymbolicLink()) {
      continue
    }

    // 符号链接解析到真实路径（判断类型与是否逃逸工作区）；
    // 但 relPath 必须基于链接自身路径计算，避免链接与同目录目标文件 relPath 撞车
    const entryPath = path.join(target, entry.name)
    let realEntry: string
    try {
      realEntry = fs.realpathSync.native(entryPath)
    }
    catch {
      continue
    }
    if (realEntry !== rootReal && !realEntry.startsWith(`${rootReal}${path.sep}`)) {
      continue
    }

    let entryStat: fs.Stats
    try {
      entryStat = fs.statSync(realEntry)
    }
    catch {
      continue
    }
    if (!entryStat.isFile() && !entryStat.isDirectory()) {
      continue
    }

    const item: WorkspaceTreeEntry = {
      name: entry.name,
      relPath: relPathOf(rootReal, entryPath),
      type: entryStat.isDirectory() ? 'directory' : 'file',
    }
    if (item.type === 'directory') {
      dirs.push(item)
    }
    else {
      files.push(item)
    }
  }

  sortEntries(dirs)
  sortEntries(files)
  return { dirs, files }
}

/**
 * 读取工作区内文本文件内容用于预览。
 * 超过 1MB 或包含二进制内容（文件头 NUL 字节探测）时拒绝。
 */
export async function readTextFile(
  workspacePath: string,
  relPath: string,
): Promise<WorkspaceTextFileContent> {
  if (!isValidRelativePath(relPath) || !relPath) {
    throw new Error(PATH_OUTSIDE_WORKSPACE)
  }

  const root = path.resolve(workspacePath)
  const target = resolveInsideWorkspace(root, relPath)

  let stat: fs.Stats
  try {
    stat = await fs.promises.stat(target)
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`文件不存在：${relPath}`)
    }
    throw new Error(`无法读取文件：${message}`)
  }
  if (!stat.isFile()) {
    throw new Error('路径不是文件')
  }
  if (stat.size > MAX_PREVIEW_BYTES) {
    throw new Error(`文件超过 1MB，无法预览（${stat.size} bytes）`)
  }

  const buffer = await fs.promises.readFile(target)
  if (buffer.subarray(0, Math.min(BINARY_SNIFF_BYTES, buffer.length)).includes(0)) {
    throw new Error('二进制文件无法预览')
  }
  return { content: buffer.toString('utf8'), size: buffer.length }
}
