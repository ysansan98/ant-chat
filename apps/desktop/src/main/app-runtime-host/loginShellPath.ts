import type { ExecFileOptions } from 'node:child_process'
import { execFile } from 'node:child_process'
import path from 'node:path'

export interface ResolveLoginShellPathOptions {
  /** 用户登录 shell；默认 process.env.SHELL，缺失时回退 /bin/zsh（macOS 默认） */
  shellPath?: string
  /** 等待 rc 完成的时间上限，避免 rc 卡死拖住应用启动 */
  timeoutMs?: number
  /** 测试注入 */
  execFileFn?: typeof execFile
  environment?: NodeJS.ProcessEnv
  /** 失败时输出警告；默认 console.warn，测试可注入断言 */
  warn?: (message: string) => void
}

const DEFAULT_TIMEOUT_MS = 5_000

let cachedLoginShellPath: string | undefined
let loginShellPathResolved = false

/**
 * 解析用户 login shell 的 PATH，只取 PATH 这一个变量。
 *
 * 打包后的 GUI 应用由 launchd 启动，process.env.PATH 不含用户 shell 注入的目录
 * （nvm/homebrew 等），execute_command 因此找不到 node 等用户工具。这里让用户
 * login shell 以交互模式执行一次 `printf %s "$PATH"`，把 stdout 的 PATH 带回：
 * - 必须 -i：zsh 只在交互启动时读取 ~/.zshrc（nvm 的 PATH 通常写在这里）。
 * - 只取 PATH：rc 中的其他变量（token、JAVA_HOME 等）不会进入命令子进程环境。
 *
 * rc 内容属于用户自己终端的既有行为；失败/超时/空结果返回 undefined，由调用方
 * 回退到应用启动 PATH，不让 rc 问题阻塞应用启动。进程生命周期内只解析一次。
 */
export function resolveLoginShellPath(
  options: ResolveLoginShellPathOptions = {},
): Promise<string | undefined> {
  if (loginShellPathResolved) {
    return Promise.resolve(cachedLoginShellPath)
  }
  loginShellPathResolved = true

  const shellPath = options.shellPath ?? options.environment?.SHELL ?? '/bin/zsh'
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const runExecFile = options.execFileFn ?? execFile
  const environment = options.environment ?? process.env
  const reportWarning = options.warn ?? ((message: string) => {
    console.warn(`[loginShellPath] ${message}`)
  })

  return new Promise((resolve) => {
    runExecFile(
      shellPath,
      ['-li', '-c', 'printf %s "$PATH"'],
      {
        timeout: timeoutMs,
        // rc 里的交互程序在非 tty 下可能向 stderr 输出噪音，忽略即可
        env: { ...environment, TERM: 'dumb' },
        windowsHide: true,
      } satisfies ExecFileOptions,
      (error, stdout) => {
        if (error) {
          reportWarning(`解析 login shell PATH 失败，回退到应用启动 PATH：${error.message}`)
          resolve(undefined)
          return
        }
        const value = stdout.trim()
        resolve(value || undefined)
      },
    )
  })
}

/**
 * 合并多段 PATH：按出现顺序去重，忽略空/未定义段。bundled CLI 目录排最前，
 * 让应用自带命令优先于用户 shell 路径。
 */
export function mergeCommandPath(...parts: Array<string | undefined>): string {
  const seen = new Set<string>()
  const merged: string[] = []
  for (const part of parts) {
    for (const directory of (part || '').split(path.delimiter)) {
      const trimmed = directory.trim()
      if (!trimmed || seen.has(trimmed))
        continue
      seen.add(trimmed)
      merged.push(trimmed)
    }
  }
  return merged.join(path.delimiter)
}
