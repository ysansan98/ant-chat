import type { AgentToolResult, BashToolInput } from '@ant-chat/shared'
import type { Buffer } from 'node:buffer'
import type { ParsedBashCommand } from './bashCommandParser'
import { spawn } from 'node:child_process'
import process from 'node:process'
import { parseBashCommand } from './bashCommandParser'

const DEFAULT_TIMEOUT_MS = 10_000
const MAX_TIMEOUT_MS = 30_000
const MAX_OUTPUT_CHARS = 20_000

export interface BashRunnerOptions {
  bashEnvironment?: Record<string, string>
  blockAgentBrowser?: boolean
  trustedPaths?: string[]
}

export type ResolvedBashToolInput = Omit<BashToolInput, 'secretEnv'> & {
  secretEnv?: Record<string, string>
}

/**
 * 执行 Bash 命令。
 *
 * 执行使用 canonical parser 的解析结果，与 scope 推导、硬阻断、只读判定和规则匹配
 * 消费同一份解析结果。
 */
export async function runBashTool(
  input: Omit<BashToolInput, 'secretEnv'>,
  workspacePath: string,
  unrestricted: boolean = false,
  options: BashRunnerOptions = {},
): Promise<AgentToolResult> {
  const parsed = parseBashCommand(input, workspacePath, {
    executableSearchPath: options.bashEnvironment?.PATH,
    trustedPaths: options.trustedPaths,
    blockAgentBrowser: options.blockAgentBrowser,
  })
  return runPreparedBashTool(parsed, unrestricted, input)
}

export async function runPreparedBashTool(
  parsed: ParsedBashCommand,
  unrestricted: boolean,
  executionInput: ResolvedBashToolInput,
): Promise<AgentToolResult> {
  const startedAt = Date.now()
  const blockedResult = (reason?: string) => ({
    ok: false,
    result: `工具 bash 执行失败：${reason || `命令被安全策略拦截。请避免重定向、管道、命令替换、sudo 以及工作区外路径。原始命令=${parsed.command}`}`,
    diagnostics: { durationMs: Date.now() - startedAt },
  })

  if (parsed.isBlocked) {
    return blockedResult(parsed.blockReason)
  }
  if (parsed.segments.length === 0) {
    return blockedResult('命令为空')
  }

  if (!unrestricted && parsed.resourceScope === 'outside') {
    return blockedResult('命令涉及工作区外路径')
  }

  // segments 只供权限分析；执行必须保持 LLM 原始命令、短路、cwd 和 shell 状态的一致性。
  return runShellCommand(
    parsed.command,
    parsed.cwd,
    Math.min(executionInput.timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS),
    executionInput.secretEnv,
    startedAt,
    parsed.executableSearchPath,
  )
}

function runShellCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
  env: Record<string, string> | undefined,
  startedAt: number,
  executableSearchPath: string | undefined,
): Promise<AgentToolResult> {
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      env: sanitizeEnv(env, executableSearchPath),
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => {
      stdout = appendTruncated(stdout, chunk.toString())
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = appendTruncated(stderr, chunk.toString())
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ ok: false, result: error.message, diagnostics: { stdout, stderr, durationMs: Date.now() - startedAt } })
    })
    child.on('close', (exitCode) => {
      clearTimeout(timer)
      const code = exitCode ?? undefined
      resolve({
        ok: !timedOut && exitCode === 0,
        result: formatProcessResult(stdout, stderr, code) || (timedOut ? 'bash 命令执行超时。' : `command exited with code ${code}`),
        diagnostics: { stdout, stderr, exitCode: code, durationMs: Date.now() - startedAt },
      })
    })
  })
}

function formatProcessResult(stdout: string, stderr: string, exitCode?: number): string {
  const parts: string[] = []
  if (stdout) {
    parts.push(`stdout:\n${stdout}`)
  }
  if (stderr) {
    parts.push(`stderr:\n${stderr}`)
  }
  if (exitCode !== undefined) {
    parts.push(`exitCode=${exitCode}`)
  }
  return parts.join('\n')
}

function appendTruncated(current: string, next: string): string {
  const value = current + next
  if (value.length <= MAX_OUTPUT_CHARS) {
    return value
  }
  return `${value.slice(0, MAX_OUTPUT_CHARS)}\n[output truncated]`
}

function sanitizeEnv(env: Record<string, string> | undefined, executableSearchPath: string | undefined): NodeJS.ProcessEnv {
  const nextEnv: NodeJS.ProcessEnv = {
    PATH: executableSearchPath,
    HOME: process.env.HOME,
    USER: process.env.USER,
    TMPDIR: process.env.TMPDIR,
  }

  for (const [key, value] of Object.entries(env || {})) {
    if (/^[A-Z_]\w*$/i.test(key) && key.toUpperCase() !== 'PATH') {
      nextEnv[key] = value
    }
  }

  return nextEnv
}
