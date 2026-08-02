import fs from 'node:fs'
import path from 'node:path'

/**
 * 将工作区输入绑定到真实目录身份，供运行时、通道和数据模块共享。
 * 工作区身份不是权限持久化细节，不能放在 permissions 模块中。
 */
export function canonicalizeWorkspacePath(workspacePath: string): string {
  if (!path.isAbsolute(workspacePath))
    throw new Error('工作区路径必须是绝对路径')
  const canonicalPath = path.normalize(fs.realpathSync.native(workspacePath))
  if (!fs.statSync(canonicalPath).isDirectory())
    throw new Error('工作区路径必须指向目录')
  return canonicalPath
}
