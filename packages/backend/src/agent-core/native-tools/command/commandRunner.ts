import type { AgentToolResult } from '@ant-chat/shared'
import type { Buffer } from 'node:buffer'
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from 'node:child_process'
import type { PreparedCommandState } from './types'
import { spawn } from 'node:child_process'
import process from 'node:process'

const DEFAULT_TIMEOUT_MS = 10_000
const MAX_OUTPUT_CHARS = 20_000
/** 发 SIGTERM 后等待进程组退出的窗口，超时补 SIGKILL */
const KILL_GRACE_MS = 1_000
/** 子进程 exit 后等待 stdio 排空的窗口；孙进程持有管道时 close 可能永不触发 */
const EXIT_DRAIN_MS = 200

export interface RunPreparedCommandOptions {
  secretEnv?: Record<string, string>
  /** 取消信号：触发后立即返回取消结果，并向整个进程组发 SIGTERM（宽限后补 SIGKILL） */
  abortSignal?: AbortSignal
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
  if (options.abortSignal?.aborted) {
    return failure('任务已取消。', startedAt)
  }

  const spawnProcess = options.spawnProcess ?? spawn
  const timeoutMs = prepared.input.timeoutMs ?? DEFAULT_TIMEOUT_MS
  return new Promise((resolve) => {
    const child = spawnProcess(
      prepared.executionPlan.executablePath,
      prepared.executionPlan.args,
      {
        cwd: prepared.executionPlan.cwd,
        // detached 让子进程成为独立进程组 leader，取消/超时才能整组终止；
        // Windows 没有进程组语义，detached 只会另开控制台，不启用。
        detached: process.platform !== 'win32',
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
    let settled = false
    let onAbort: () => void = () => {}
    let timer: ReturnType<typeof setTimeout> | undefined
    let drainTimer: ReturnType<typeof setTimeout> | undefined

    const settle = (result: AgentToolResult) => {
      if (settled)
        return
      settled = true
      clearTimeout(timer)
      clearTimeout(drainTimer)
      options.abortSignal?.removeEventListener('abort', onAbort)
      resolve(result)
    }

    onAbort = () => {
      terminateProcessTree(child, 'SIGTERM')
      scheduleHardKill(child)
      settle({
        ok: false,
        result: '任务已取消。',
        diagnostics: { stdout, stderr, durationMs: Date.now() - startedAt },
      })
    }

    timer = setTimeout(() => {
      terminateProcessTree(child, 'SIGTERM')
      scheduleHardKill(child)
      settle({
        ok: false,
        result: formatProcessResult(stdout, stderr, undefined) || '命令执行超时。',
        diagnostics: { stdout, stderr, durationMs: Date.now() - startedAt },
      })
    }, timeoutMs)

    options.abortSignal?.addEventListener('abort', onAbort, { once: true })
    if (options.abortSignal?.aborted) {
      onAbort()
      return
    }

    child.stdout.on('data', (chunk: Buffer) => {
      stdout = appendTruncated(stdout, chunk.toString())
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = appendTruncated(stderr, chunk.toString())
    })
    child.on('error', (error) => {
      settle({
        ok: false,
        result: error.message,
        diagnostics: { stdout, stderr, durationMs: Date.now() - startedAt },
      })
    })
    child.on('close', (exitCode) => {
      if (settled)
        return
      settle(completeResult(exitCode, stdout, stderr, startedAt))
    })
    child.on('exit', (exitCode) => {
      if (settled)
        return
      // 孙进程仍持有 stdio 管道时 close 永不触发；exit 后留一个排空窗口兜底收尾，
      // 避免 Promise 因 close 依赖而悬空。
      drainTimer = setTimeout(() => {
        if (settled)
          return
        settle(completeResult(exitCode, stdout, stderr, startedAt))
      }, EXIT_DRAIN_MS)
    })
  })
}

function completeResult(
  exitCode: number | null,
  stdout: string,
  stderr: string,
  startedAt: number,
): AgentToolResult {
  const code = exitCode ?? undefined
  return {
    ok: exitCode === 0,
    result: formatProcessResult(stdout, stderr, code) || `command exited with code ${code}`,
    diagnostics: { stdout, stderr, exitCode: code, durationMs: Date.now() - startedAt },
  }
}

function terminateProcessTree(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals): void {
  if (child.pid === undefined)
    return
  if (process.platform === 'win32') {
    // Windows 没有 POSIX 进程组；taskkill /T /F 终止整棵命令树（含孙进程）。
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    }).unref?.()
    return
  }
  try {
    process.kill(-child.pid, signal)
  }
  catch {
    // 进程组可能已退出或尚未建立，忽略
  }
}

function scheduleHardKill(child: ChildProcessWithoutNullStreams): void {
  const hardKillTimer = setTimeout(() => {
    terminateProcessTree(child, 'SIGKILL')
  }, KILL_GRACE_MS)
  hardKillTimer.unref?.()
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
