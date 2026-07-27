import type { ToolApprovalRuleInput } from '@ant-chat/shared'
import fs from 'node:fs'
import path from 'node:path'
import { ToolApprovalRuleInputSchema } from '@ant-chat/shared'
import { resolveExecutablePath } from '../../executableIdentity'

/** 规范化管理页提交的规则能力，持久层只接收后端确认过的资源身份。 */
export function canonicalizePermissionRuleInput(
  value: unknown,
): ToolApprovalRuleInput {
  const input = ToolApprovalRuleInputSchema.parse(value)
  let canonical: ToolApprovalRuleInput
  switch (input.kind) {
    case 'command': {
      const executable = input.executable.trim()
      canonical = {
        ...input,
        executable: canonicalizeExecutable(executable),
      }
      break
    }
    case 'filesystem':
      canonical = {
        ...input,
        canonicalPath: canonicalizeFilesystemPath(input),
      }
      break
    case 'mcp-tool':
      canonical = {
        ...input,
        serverName: input.serverName.trim(),
        toolName: input.toolName.trim(),
      }
      break
  }
  return ToolApprovalRuleInputSchema.parse(canonical)
}

export function canonicalizeWorkspacePath(workspacePath: string): string {
  if (!path.isAbsolute(workspacePath))
    throw new Error('工作区路径必须是绝对路径')
  const canonicalPath = path.normalize(fs.realpathSync.native(workspacePath))
  if (!fs.statSync(canonicalPath).isDirectory())
    throw new Error('工作区路径必须指向目录')
  return canonicalPath
}

function canonicalizeExecutable(executable: string): string {
  // PATH/相对命令原样保存；绝对路径仅验证存在性，不解析 symlink。
  // 详见 executableIdentity.ts 的安全模型说明。
  if (!path.isAbsolute(executable))
    return executable

  const resolved = resolveExecutablePath(executable)
  if (!resolved)
    throw new Error(`可执行文件不存在或不可执行：${executable}`)
  return resolved
}

function canonicalizeFilesystemPath(
  input: Extract<ToolApprovalRuleInput, { kind: 'filesystem' }>,
): string {
  if (!path.isAbsolute(input.canonicalPath))
    throw new Error('文件系统权限路径必须是绝对路径')

  const requestedPath = path.normalize(path.resolve(input.canonicalPath))
  const exists = fs.existsSync(requestedPath)
  if (!exists && (input.access === 'read' || input.targetType === 'directory'))
    throw new Error('读取和目录权限必须指向已存在的路径')

  const canonicalPath = exists
    ? path.normalize(fs.realpathSync.native(requestedPath))
    : canonicalizeMissingPath(requestedPath)

  if (exists) {
    const stat = fs.statSync(canonicalPath)
    if (input.targetType === 'directory' && !stat.isDirectory())
      throw new Error('目录权限必须指向目录')
    if (input.targetType === 'file' && !stat.isFile())
      throw new Error('文件权限必须指向文件')
  }
  return canonicalPath
}

/** 不存在的写入目标绑定到最近存在祖先的真实路径，避免祖先 symlink 改变资源身份。 */
function canonicalizeMissingPath(requestedPath: string): string {
  const missingSegments: string[] = []
  let existingAncestor = requestedPath
  while (!fs.existsSync(existingAncestor)) {
    const parent = path.dirname(existingAncestor)
    if (parent === existingAncestor)
      throw new Error('无法找到文件系统权限路径的存在祖先')
    missingSegments.unshift(path.basename(existingAncestor))
    existingAncestor = parent
  }
  const canonicalAncestor = fs.realpathSync.native(existingAncestor)
  return path.normalize(path.join(canonicalAncestor, ...missingSegments))
}
