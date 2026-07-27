import type { AgentToolResult } from '@ant-chat/shared'
import type { Buffer } from 'node:buffer'
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from 'node:child_process'
import type { PreparedCommandState } from './types'
import { spawn } from 'node:child_process'

const DEFAULT_TIMEOUT_MS = 10_000
const MAX_TIMEOUT_MS = 30_000
const MAX_OUTPUT_CHARS = 20_000

export interface RunPreparedCommandOptions {
  secretEnv?: Record<string, string>
  spawnProcess?: (
    executablePath: string,
    args: readonly string[],
    options: SpawnOptionsWithoutStdio,
  ) => ChildProcessWithoutNullStreams
}

export async function runPreparedCommand(
  prepared: PreparedCommandState,
  unrestricted: boolean,
  options: RunPreparedCommandOptions = {},
): Promise<AgentToolResult> {
  const startedAt = Date.now()
  if (prepared.risk === 'bottomline_block') {
    return failure(prepared.riskReason || '命令命中不可覆盖的底线保护', startedAt)
  }
  if (!unrestricted && prepared.resourceScope === 'outside') {
    return failure('命令涉及工作区外资源', startedAt)
  }

  const spawnProcess = options.spawnProcess ?? spawn
  const timeoutMs = Math.min(prepared.input.timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS)
  return new Promise((resolve) => {
    const child = spawnProcess(
      prepared.executionPlan.executablePath,
      prepared.executionPlan.args,
      {
        cwd: prepared.executionPlan.cwd,
        shell: false,
        windowsHide: true,
        env: {
          ...prepared.executionPlan.environment,
          ...sanitizeSecretEnvironment(options.secretEnv),
        },
      },
    )
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
      resolve({
        ok: false,
        result: error.message,
        diagnostics: { stdout, stderr, durationMs: Date.now() - startedAt },
      })
    })
    child.on('close', (exitCode) => {
      clearTimeout(timer)
      const code = exitCode ?? undefined
      resolve({
        ok: !timedOut && exitCode === 0,
        result: formatProcessResult(stdout, stderr, code)
          || (timedOut ? '命令执行超时。' : `command exited with code ${code}`),
        diagnostics: {
          stdout,
          stderr,
          exitCode: code,
          durationMs: Date.now() - startedAt,
        },
      })
    })
  })
}

function failure(reason: string, startedAt: number): AgentToolResult {
  return {
    ok: false,
    result: `工具 execute_command 执行失败：${reason}`,
    diagnostics: { durationMs: Date.now() - startedAt },
  }
}

function sanitizeSecretEnvironment(environment: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(environment || {}).filter(([key]) =>
    /^[A-Z_]\w*$/i.test(key) && key.toUpperCase() !== 'PATH',
  ))
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
