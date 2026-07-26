import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

/**
 * 验证管理页提交的可执行命令身份，返回供持久化使用的字符串。
 *
 * 安全模型：PATH 环境变量可信，命令黑白名单与持久规则只按用户输入的命令字符串匹配，
 * 不做 PATH 遍历或 symlink 解析。原因：
 * - PATH 命令（node、ls 等）的 symlink 指向变化本就不影响规则命中，对绝对路径命令
 *   做实时 realpath 校验会造成不对称。
 * - 命令能否真正执行由 spawn 自行处理（not found 自然失败），规则匹配不承担路径
 *   有效性校验。
 *
 * 仅在管理页提交绝对路径规则时验证文件存在且可执行，防止保存垃圾路径；验证通过后
 * 按用户输入的原始字符串存库，不解析 symlink。PATH/相对路径命令原样返回。
 *
 * 返回 undefined 表示绝对路径命令指向的文件不存在或不可执行。
 */
export function resolveExecutablePath(command: string): string | undefined {
  // PATH/相对命令按字符串身份保存，不查文件系统。
  if (!path.isAbsolute(command)) {
    return command
  }
  return isExecutableFile(command) ? command : undefined
}

function isExecutableFile(filePath: string): boolean {
  try {
    if (!fs.statSync(filePath).isFile())
      return false
    fs.accessSync(filePath, process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK)
    return true
  }
  catch {
    return false
  }
}
