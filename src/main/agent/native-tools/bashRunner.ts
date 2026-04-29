import type { AgentToolResult, BashToolInput } from '@ant-chat/shared'
import type { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { AGENT_BASH_COMMAND_BLOCKED, AGENT_BASH_TIMEOUT, WORKSPACE_INVALID_PATH } from '@ant-chat/shared'
import { createPathPolicyByMode } from './pathPolicy'

const DEFAULT_TIMEOUT_MS = 10_000
const MAX_TIMEOUT_MS = 30_000
const MAX_OUTPUT_CHARS = 20_000
const READ_ONLY_COMMANDS = new Set(['pwd', 'ls', 'cat', 'rg', 'find'])
const BLOCKED_COMMANDS = new Set(['rm', 'mv', 'cp', 'chmod', 'chown', 'sudo', 'curl', 'wget', 'pnpm', 'npm', 'yarn', 'bun', 'pip', 'brew'])
const BLOCKED_TOKENS = ['>', '<', '|', ';', '||', '`', '$(', '\n']

export async function runBashTool(input: BashToolInput, workspacePath: string, unrestricted: boolean = false): Promise<AgentToolResult> {
  const startedAt = Date.now()
  let commands: Array<{ command: string, args: string[] }>
  try {
    commands = parseCommands(input.command)
  }
  catch {
    return { ok: false, error: AGENT_BASH_COMMAND_BLOCKED, durationMs: Date.now() - startedAt }
  }
  if (commands.length === 0 || !commands.every(item => isCommandAllowed(item.command, item.args))) {
    return { ok: false, error: AGENT_BASH_COMMAND_BLOCKED, durationMs: Date.now() - startedAt }
  }

  const policy = createPathPolicyByMode(workspacePath, unrestricted ? 'unrestricted' : 'workspace')
  const cwd = policy.resolveExisting(input.cwd || '.')
  for (const item of commands) {
    if (item.command === 'mkdir' && !validateMkdirTargets(item.args.slice(1), cwd, policy))
      return { ok: false, error: WORKSPACE_INVALID_PATH, durationMs: Date.now() - startedAt }
  }
  const timeoutMs = Math.min(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS)
  const perCommandTimeoutMs = Math.max(Math.floor(timeoutMs / commands.length), 1000)

  let stdout = ''
  let stderr = ''
  let exitCode = 0
  for (const item of commands) {
    const result = await runSingleCommand(item, cwd, perCommandTimeoutMs, input.env, startedAt)
    stdout = appendTruncated(stdout, result.stdout || '')
    stderr = appendTruncated(stderr, result.stderr || '')
    exitCode = result.exitCode ?? (result.ok ? 0 : 1)
    if (!result.ok) {
      return {
        ok: false,
        error: result.error,
        stdout,
        stderr,
        exitCode,
        durationMs: Date.now() - startedAt,
      }
    }
  }

  return {
    ok: true,
    stdout,
    stderr,
    exitCode,
    durationMs: Date.now() - startedAt,
  }
}

function runSingleCommand(
  parsed: { command: string, args: string[] },
  cwd: string,
  timeoutMs: number,
  env: Record<string, string> | undefined,
  startedAt: number,
): Promise<AgentToolResult> {
  return new Promise((resolve) => {
    const child = spawn(parsed.command, parsed.args, {
      cwd,
      shell: false,
      env: sanitizeEnv(env),
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
      resolve({ ok: false, error: error.message, stdout, stderr, durationMs: Date.now() - startedAt })
    })

    child.on('close', (exitCode) => {
      clearTimeout(timer)
      if (timedOut) {
        resolve({ ok: false, error: AGENT_BASH_TIMEOUT, stdout, stderr, exitCode: exitCode ?? undefined, durationMs: Date.now() - startedAt })
        return
      }

      resolve({
        ok: exitCode === 0,
        stdout,
        stderr,
        exitCode: exitCode ?? undefined,
        durationMs: Date.now() - startedAt,
      })
    })
  })
}

function parseCommands(command: string): Array<{ command: string, args: string[] }> {
  const segments = command.split('&&').map(item => item.trim()).filter(Boolean)
  if (segments.length === 0) {
    throw new Error(AGENT_BASH_COMMAND_BLOCKED)
  }
  return segments.map(parseSingleCommand)
}

function parseSingleCommand(command: string): { command: string, args: string[] } {
  if (BLOCKED_TOKENS.some(token => command.includes(token))) {
    throw new Error(AGENT_BASH_COMMAND_BLOCKED)
  }

  const tokens = command.match(/"[^"]*"|'[^']*'|\S+/g)?.map(token => token.replace(/^['"]|['"]$/g, '')) ?? []
  if (tokens.length === 0) {
    throw new Error(AGENT_BASH_COMMAND_BLOCKED)
  }

  return { command: tokens[0], args: tokens.slice(1) }
}

function isCommandAllowed(command: string, args: string[]): boolean {
  if (BLOCKED_COMMANDS.has(command)) {
    return false
  }

  if (command === 'mkdir') {
    return isAllowedMkdir(args)
  }

  if (!READ_ONLY_COMMANDS.has(command)) {
    return false
  }

  return !args.some(hasObviousPathEscape)
}

function isAllowedMkdir(args: string[]): boolean {
  if (args.length < 2 || args[0] !== '-p') {
    return false
  }

  return args.slice(1).every(arg => !hasObviousPathEscape(arg))
}

function validateMkdirTargets(targets: string[], cwd: string, policy: ReturnType<typeof createPathPolicyByMode>): boolean {
  return targets.every((target) => {
    const targetPath = path.resolve(cwd, target)
    if (!policy.isInsideWorkspace(targetPath)) {
      return false
    }

    let existingAncestor = targetPath
    while (!fs.existsSync(existingAncestor)) {
      const parent = path.dirname(existingAncestor)
      if (parent === existingAncestor) {
        return false
      }
      existingAncestor = parent
    }

    const realAncestor = fs.realpathSync.native(existingAncestor)
    return policy.isInsideWorkspace(realAncestor)
  })
}

function hasObviousPathEscape(arg: string): boolean {
  return arg.startsWith('/') || arg.startsWith('~') || arg === '..' || arg.includes('../') || arg.includes('..\\')
}

function appendTruncated(current: string, next: string): string {
  const value = current + next
  if (value.length <= MAX_OUTPUT_CHARS) {
    return value
  }
  return `${value.slice(0, MAX_OUTPUT_CHARS)}\n[output truncated]`
}

function sanitizeEnv(env: Record<string, string> | undefined): NodeJS.ProcessEnv {
  const nextEnv: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    USER: process.env.USER,
    TMPDIR: process.env.TMPDIR,
  }

  for (const [key, value] of Object.entries(env || {})) {
    if (/^[A-Z_]\w*$/i.test(key)) {
      nextEnv[key] = value
    }
  }

  return nextEnv
}
