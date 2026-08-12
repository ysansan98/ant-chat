import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import process from 'node:process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/**
 * 用系统默认应用打开文件。
 * Electron 运行时走 shell.openPath；Node（web）运行时按平台调用系统打开命令。
 * 路径必须已经过工作区边界校验，这里只负责打开，不做任何 shell 拼接。
 */
export async function openPathWithDefaultApp(absolutePath: string): Promise<void> {
  if (process.versions.electron) {
    const require = createRequire(import.meta.url)
    const { shell } = require('electron') as {
      shell: { openPath: (target: string) => Promise<string> }
    }
    const errorMessage = await shell.openPath(absolutePath)
    if (errorMessage) {
      throw new Error(errorMessage)
    }
    return
  }

  const { platform } = process
  if (platform === 'darwin') {
    await execFileAsync('open', [absolutePath])
  }
  else if (platform === 'win32') {
    await execFileAsync('cmd', ['/c', 'start', '', absolutePath])
  }
  else {
    await execFileAsync('xdg-open', [absolutePath])
  }
}
