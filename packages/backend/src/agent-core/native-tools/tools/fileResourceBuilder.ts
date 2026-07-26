import type { ApprovalCandidate, FilesystemRule } from '@ant-chat/shared'
import fs from 'node:fs'
import path from 'node:path'
import { normalizeCandidatePath } from '../pathPolicy'

/**
 * 文件系统规则的 canonical 资源构建器。
 *
 * - 目录读取规则覆盖 read_file/list_dir/glob_files/grep_files
 * - 匹配使用 realpath
 * - 目标尚不存在时绑定最近存在祖先的真实路径
 * - symlink 逃逸不能命中规则
 *
 * 详见 docs/adr/0001-tool-approval-rules.md §6。
 */

const READ_FILE_TOOLS = new Set(['read_file'])
const LIST_DIR_TOOLS = new Set(['list_dir', 'glob_files', 'grep_files'])
const WRITE_FILE_TOOLS = new Set(['write_file', 'edit_file'])
const FILE_TOOLS = new Set([...READ_FILE_TOOLS, ...LIST_DIR_TOOLS, ...WRITE_FILE_TOOLS])

export interface FileResource {
  /** canonical 真实路径 */
  canonicalPath: string
  /** 资源类型 */
  targetType: 'file' | 'directory'
  /** 访问类型 */
  access: 'read' | 'write'
  /** 展示路径 */
  displayPath: string
}

/**
 * 从工具输入构建 canonical 文件资源。
 *
 * 不存在目标时绑定最近存在祖先的真实路径。
 * symlink 改靶通过 realpath 解析，逃逸不能命中规则。
 */
export function buildFileResource(
  toolName: string,
  input: Record<string, unknown>,
  workspacePath: string,
): FileResource | null {
  if (!FILE_TOOLS.has(toolName)) {
    return null
  }

  const rawPath = String(input.path ?? '.')
  const absolutePath = path.isAbsolute(rawPath) ? path.resolve(rawPath) : path.resolve(workspacePath, rawPath)
  const canonicalPath = normalizeCandidatePath(absolutePath)

  // 判断是文件还是目录
  let targetType: 'file' | 'directory'
  try {
    const stat = fs.statSync(canonicalPath)
    targetType = stat.isDirectory() ? 'directory' : 'file'
  }
  catch {
    // 不存在的目标：glob/grep 通常搜索目录，read_file 通常是文件
    if (LIST_DIR_TOOLS.has(toolName)) {
      targetType = 'directory'
    }
    else if (READ_FILE_TOOLS.has(toolName) || WRITE_FILE_TOOLS.has(toolName)) {
      targetType = 'file'
    }
    else {
      targetType = 'file'
    }
  }

  const access: 'read' | 'write' = WRITE_FILE_TOOLS.has(toolName) ? 'write' : 'read'

  return {
    canonicalPath,
    targetType,
    access,
    displayPath: rawPath,
  }
}

/**
 * 生成文件系统审批候选。
 *
 * - read_file：可选择当前文件精确读取或其直接父目录递归读取
 * - list_dir/glob_files/grep_files：可选择该请求目录递归读取
 * - write_file/edit_file：精确文件写入
 */
export function createFilesystemCandidate(
  resource: FileResource,
): ApprovalCandidate | null {
  if (resource.access === 'write') {
    return {
      type: 'filesystem',
      access: 'write',
      targetType: 'file',
      canonicalPath: resource.canonicalPath,
      displayPath: resource.displayPath,
      suggestRecursive: false,
      canParentDirectory: false,
    }
  }

  // 读取
  if (resource.targetType === 'directory') {
    return {
      type: 'filesystem',
      access: 'read',
      targetType: 'directory',
      canonicalPath: resource.canonicalPath,
      displayPath: resource.displayPath,
      suggestRecursive: true,
      canParentDirectory: false,
    }
  }

  // 文件读取：可选择精确文件或父目录递归读取
  return {
    type: 'filesystem',
    access: 'read',
    targetType: 'file',
    canonicalPath: resource.canonicalPath,
    displayPath: resource.displayPath,
    suggestRecursive: false,
    canParentDirectory: true,
  }
}

/**
 * 检查文件资源是否匹配文件系统规则。
 *
 * - 文件规则：canonicalPath 精确匹配
 * - 目录规则：资源在 canonicalPath 或其子目录下（递归读取）
 */
export function matchFilesystemRule(resource: FileResource, rule: FilesystemRule): boolean {
  if (rule.access !== resource.access) {
    return false
  }

  if (rule.targetType === 'directory') {
    // 目录规则必须是递归读取
    if (!rule.recursive) {
      return false
    }
    // 资源必须在目录或其子目录下
    return isInsideOrEqual(rule.canonicalPath, resource.canonicalPath)
  }

  // 文件规则：精确匹配
  return rule.canonicalPath === resource.canonicalPath
}

function isInsideOrEqual(dirPath: string, candidatePath: string): boolean {
  const relative = path.relative(dirPath, candidatePath)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

export { FILE_TOOLS, LIST_DIR_TOOLS, READ_FILE_TOOLS, WRITE_FILE_TOOLS }
