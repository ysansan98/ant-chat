import type { AgentCommandHost, ILogger } from '@ant-chat/shared'
import type { Buffer } from 'node:buffer'
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from 'node:child_process'
import type { HookCommandHandler, HookConfigSource, HookDecision, HookEvent, HookHandlerExecution, HookInput } from './types'
import { spawn } from 'node:child_process'
import process from 'node:process'
import { defaultHookTimeoutMs } from './types'

const MAX_OUTPUT_CHARS = 20_000
const KILL_GRACE_MS = 1_000
const EXIT_DRAIN_MS = 200

export interface HookCommandExecutionContext {
  event: HookEvent
  command: string
  cwd: string
  env: Readonly<Record<string, string>>
  stdin: string
  timeoutMs: number
  signal?: AbortSignal
}

export interface HookCommandExecutionOutcome {
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  error?: string
  durationMs: number
}

export type HookCommandExecutor = (context: HookCommandExecutionContext) => Promise<HookCommandExecutionOutcome>

export interface RunHookHandlerRequest {
  event: HookEvent
  source: HookConfigSource
  handler: HookCommandHandler
  input: HookInput
  cwd: string
  signal?: AbortSignal
}

export interface HookRunnerOptions {
  executor: HookCommandExecutor
  logger?: ILogger
}

export interface HookRunner {
  runHandler: (request: RunHookHandlerRequest) => Promise<HookHandlerExecution>
}

/**
 * 单条 command handler 执行：spawn、stdin JSON、超时、stdout/exit code 解析。
 *
 * 解析规则（D5）：
 * - exit code 2 → deny（stderr 作为 reason）；
 * - stdout JSON 含 `decision` → 使用该决策；
 * - 其余（非 2 非零退出、信号终止、超时、解析失败）一律无决策，仅记 error。
 */
export function createHookRunner(options: HookRunnerOptions): HookRunner {
  const { executor, logger } = options

  return {
    async runHandler(request) {
      const { event, source, handler, input, cwd, signal } = request
      const timeoutMs = handler.timeout ?? defaultHookTimeoutMs(event)
      const command = resolveCommand(handler)

      let outcome: HookCommandExecutionOutcome
      try {
        outcome = await executor({
          event,
          command,
          cwd,
          env: buildHookEnvironment(event, input),
          stdin: `${JSON.stringify(input)}\n`,
          timeoutMs,
          signal,
        })
      }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger?.warn(`hook 执行异常（${event} / ${source}）`, error)
        return {
          event,
          source,
          command,
          exitCode: null,
          timedOut: false,
          error: message,
          durationMs: 0,
        }
      }

      return interpretExecution({ event, source, command, outcome, logger })
    },
  }
}

function resolveCommand(handler: HookCommandHandler): string {
  if (process.platform === 'win32' && handler.commandWindows)
    return handler.commandWindows
  return handler.command
}

function buildHookEnvironment(event: HookEvent, input: HookInput): Record<string, string> {
  // 只注入只读标识，不含任何 secret。
  const env: Record<string, string> = {
    HOOK_EVENT: event,
    HOOK_SESSION_ID: input.session_id,
    HOOK_CONVERSATION_ID: input.conversation_id,
    HOOK_CWD: input.cwd,
  }
  const toolName = input.tool_name
  if (typeof toolName === 'string' && toolName)
    env.HOOK_TOOL_NAME = toolName
  return env
}

const DECISIONS = new Set<HookDecision>(['allow', 'deny', 'ask', 'block'])

function interpretExecution(params: {
  event: HookEvent
  source: HookConfigSource
  command: string
  outcome: HookCommandExecutionOutcome
  logger?: ILogger
}): HookHandlerExecution {
  const { event, source, command, outcome, logger } = params
  const base: HookHandlerExecution = {
    event,
    source,
    command,
    exitCode: outcome.exitCode,
    timedOut: outcome.timedOut,
    durationMs: outcome.durationMs,
  }

  if (outcome.timedOut) {
    logger?.warn(`hook 超时（${event} / ${source}），按无决策继续`, { command })
    return { ...base, error: 'hook_timeout' }
  }
  if (outcome.error) {
    return { ...base, error: outcome.error }
  }

  // exit code 2 是唯一无需结构化输出的显式拒绝方式。
  if (outcome.exitCode === 2) {
    const parsed = parseStdoutJson(outcome.stdout)
    return {
      ...base,
      decision: 'deny',
      reason: pickText(parsed?.reason) || firstLine(outcome.stderr) || firstLine(outcome.stdout) || 'hook 显式拒绝执行',
      additionalContext: pickText(parsed?.additionalContext),
      continue: false,
    }
  }

  const parsed = parseStdoutJson(outcome.stdout)
  if (parsed) {
    const decision = isDecision(parsed.decision) ? parsed.decision : undefined
    const result: HookHandlerExecution = {
      ...base,
      decision,
      reason: pickText(parsed.reason),
      additionalContext: pickText(parsed.additionalContext),
      continue: typeof parsed.continue === 'boolean' ? parsed.continue : undefined,
    }
    if (decision || typeof parsed.continue === 'boolean')
      return result
    if (outcome.exitCode !== 0)
      return { ...result, error: `hook exited with code ${outcome.exitCode}` }
    return result
  }

  if (outcome.exitCode !== 0) {
    // 非 2 非零退出是脚本自身错误，不是显式拒绝。
    return { ...base, error: `hook exited with code ${outcome.exitCode}${firstLine(outcome.stderr) ? `: ${firstLine(outcome.stderr)}` : ''}` }
  }
  return base
}

function parseStdoutJson(stdout: string): Record<string, unknown> | undefined {
  const text = stdout.trim()
  if (!text)
    return undefined
  try {
    const value = JSON.parse(text)
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined
  }
  catch {
    return undefined
  }
}

function isDecision(value: unknown): value is HookDecision {
  return typeof value === 'string' && DECISIONS.has(value as HookDecision)
}

function pickText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function firstLine(value: string | undefined): string | undefined {
  const line = value?.split('\n').map(item => item.trim()).find(Boolean)
  return line
}

/**
 * 基于命令宿主的默认执行器：与内置命令工具共享 PATH/login shell 语义，
 * 通过 shell -c 执行 hook 命令行。
 */
export function createCommandHostHookExecutor(
  host: AgentCommandHost,
  spawnProcess: (
    executablePath: string,
    args: readonly string[],
    options: SpawnOptionsWithoutStdio,
  ) => ChildProcessWithoutNullStreams = spawn,
): HookCommandExecutor {
  return async (context) => {
    const startedAt = Date.now()
    if (host.status !== 'available') {
      return {
        exitCode: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        error: `命令宿主不可用：${host.reason}`,
        durationMs: 0,
      }
    }

    const plan = toExecutionPlan(host, context.command)
    const env = { ...host.environment, ...context.env }
    return await new Promise<HookCommandExecutionOutcome>((resolve) => {
      let child: ChildProcessWithoutNullStreams
      try {
        child = spawnProcess(plan.executablePath, plan.args, {
          cwd: context.cwd,
          detached: process.platform !== 'win32',
          shell: false,
          windowsHide: true,
          env,
        })
      }
      catch (error) {
        resolve({
          exitCode: null,
          stdout: '',
          stderr: '',
          timedOut: false,
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - startedAt,
        })
        return
      }

      let stdout = ''
      let stderr = ''
      let settled = false
      let timer: ReturnType<typeof setTimeout> | undefined
      let drainTimer: ReturnType<typeof setTimeout> | undefined
      let onAbort: () => void = () => {}

      const settle = (outcome: HookCommandExecutionOutcome) => {
        if (settled)
          return
        settled = true
        clearTimeout(timer)
        clearTimeout(drainTimer)
        context.signal?.removeEventListener('abort', onAbort)
        resolve(outcome)
      }

      const terminate = () => {
        terminateProcessTree(child)
      }

      onAbort = () => {
        terminate()
        settle({ exitCode: null, stdout, stderr, timedOut: false, error: 'hook_cancelled', durationMs: Date.now() - startedAt })
      }

      timer = setTimeout(() => {
        terminate()
        settle({ exitCode: null, stdout, stderr, timedOut: true, durationMs: Date.now() - startedAt })
      }, context.timeoutMs)

      context.signal?.addEventListener('abort', onAbort, { once: true })
      if (context.signal?.aborted) {
        onAbort()
        return
      }

      const finish = (exitCode: number | null) => {
        settle({
          exitCode,
          stdout,
          stderr,
          timedOut: false,
          durationMs: Date.now() - startedAt,
        })
      }

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout = appendTruncated(stdout, chunk.toString())
      })
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr = appendTruncated(stderr, chunk.toString())
      })
      child.on('error', (error) => {
        settle({ exitCode: null, stdout, stderr, timedOut: false, error: error.message, durationMs: Date.now() - startedAt })
      })
      child.on('close', exitCode => finish(exitCode))
      child.on('exit', (exitCode) => {
        drainTimer = setTimeout(finish, EXIT_DRAIN_MS, exitCode)
      })

      // stdin 写入失败（如进程立即退出）不应让 hook 悬空。
      child.stdin?.on('error', () => {})
      child.stdin?.end(context.stdin)
    })
  }
}

function toExecutionPlan(host: Extract<AgentCommandHost, { status: 'available' }>, command: string): {
  executablePath: string
  args: string[]
} {
  if (host.adapter === 'bash')
    return { executablePath: host.executablePath, args: ['--noprofile', '--norc', '-c', command] }
  if (host.interpreter === 'cmd')
    return { executablePath: host.executablePath, args: ['/d', '/s', '/c', command] }
  return { executablePath: host.executablePath, args: ['-NoProfile', '-NonInteractive', '-Command', command] }
}

function terminateProcessTree(child: ChildProcessWithoutNullStreams): void {
  if (child.pid === undefined)
    return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).unref?.()
    return
  }
  try {
    process.kill(-child.pid, 'SIGTERM')
  }
  catch {
    // 进程组可能已退出或尚未建立，忽略
  }
  const hardKillTimer = setTimeout(() => {
    try {
      process.kill(-child.pid!, 'SIGKILL')
    }
    catch {
      // 已退出
    }
  }, KILL_GRACE_MS)
  hardKillTimer.unref?.()
}

function appendTruncated(current: string, next: string): string {
  const value = current + next
  if (value.length <= MAX_OUTPUT_CHARS)
    return value
  return `${value.slice(0, MAX_OUTPUT_CHARS)}\n[output truncated]`
}
