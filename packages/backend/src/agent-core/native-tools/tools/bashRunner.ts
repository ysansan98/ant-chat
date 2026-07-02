import type { AgentToolResult, BashToolInput, ToolScope } from '@ant-chat/shared'
import type { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { WORKSPACE_INVALID_PATH } from '@ant-chat/shared'
import { createPathPolicyByMode } from '../pathPolicy'

const DEFAULT_TIMEOUT_MS = 10_000
const MAX_TIMEOUT_MS = 30_000
const MAX_OUTPUT_CHARS = 20_000
const READ_ONLY_COMMANDS = new Set(['pwd', 'ls', 'cat', 'rg', 'find'])
const BLOCKED_TOKENS = ['>', '<', '|', ';', '||', '`', '$(', '\n']

interface BashRunnerOptions {
  blockAgentBrowser?: boolean
}

export async function runBashTool(
  input: BashToolInput,
  workspacePath: string,
  unrestricted: boolean = false,
  options: BashRunnerOptions = {},
): Promise<AgentToolResult> {
  const startedAt = Date.now()
  const blockedResult = () => ({
    ok: false,
    result: `工具 bash 执行失败：命令被安全策略拦截。请仅使用允许的只读命令（如 pwd、ls、cat、rg、find），不要使用重定向、管道、sudo、rm 等。原始命令=${input.command}`,
    diagnostics: { durationMs: Date.now() - startedAt },
  })
  let commands: Array<{ command: string, args: string[] }>
  try {
    commands = parseCommands(input.command)
  }
  catch {
    return blockedResult()
  }
  if (commands.length === 0) {
    return blockedResult()
  }
  if (options.blockAgentBrowser && commands.some(isAgentBrowserCommand)) {
    return blockedResult()
  }
  if (!unrestricted && !commands.every(item => isCommandAllowed(item.command, item.args))) {
    return blockedResult()
  }

  const policy = createPathPolicyByMode(workspacePath, unrestricted ? 'unrestricted' : 'workspace')
  const cwd = policy.resolveExisting(input.cwd || '.')
  for (const item of commands) {
    if (item.command === 'mkdir' && !validateMkdirTargets(item.args.slice(1), cwd, policy))
      return { ok: false, result: 'mkdir 目标路径不在允许的工作区范围内。', diagnostics: { durationMs: Date.now() - startedAt, data: { code: WORKSPACE_INVALID_PATH } } }
  }
  const timeoutMs = Math.min(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS)
  const perCommandTimeoutMs = Math.max(Math.floor(timeoutMs / commands.length), 1000)

  let stdout = ''
  let stderr = ''
  let exitCode = 0
  for (const item of commands) {
    const result = await runSingleCommand(item, cwd, perCommandTimeoutMs, input.env as Record<string, string> | undefined, startedAt)
    stdout = appendTruncated(stdout, result.diagnostics?.stdout || '')
    stderr = appendTruncated(stderr, result.diagnostics?.stderr || '')
    exitCode = result.diagnostics?.exitCode ?? (result.ok ? 0 : 1)
    if (!result.ok) {
      return {
        ok: false,
        result: formatProcessResult(stdout, stderr, exitCode) || result.result,
        diagnostics: {
          stdout,
          stderr,
          exitCode,
          durationMs: Date.now() - startedAt,
        },
      }
    }
  }

  return {
    ok: true,
    result: formatProcessResult(stdout, stderr, exitCode),
    diagnostics: {
      stdout,
      stderr,
      exitCode,
      durationMs: Date.now() - startedAt,
    },
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
      resolve({
        ok: false,
        result: error.message,
        diagnostics: { stdout, stderr, durationMs: Date.now() - startedAt },
      })
    })

    child.on('close', (exitCode) => {
      clearTimeout(timer)
      if (timedOut) {
        resolve({
          ok: false,
          result: formatProcessResult(stdout, stderr, exitCode ?? undefined) || 'bash 命令执行超时。',
          diagnostics: { stdout, stderr, exitCode: exitCode ?? undefined, durationMs: Date.now() - startedAt },
        })
        return
      }

      const ok = exitCode === 0
      const code = exitCode ?? undefined
      resolve({
        ok,
        result: formatProcessResult(stdout, stderr, code) || (ok ? '' : `command exited with code ${code}`),
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

function parseCommands(command: string): Array<{ command: string, args: string[] }> {
  const segments = command.split('&&').map(item => item.trim()).filter(Boolean)
  if (segments.length === 0) {
    throw new Error('bash command is blocked')
  }
  return segments.map(parseSingleCommand)
}

function parseSingleCommand(command: string): { command: string, args: string[] } {
  const tokens = command.match(/"[^"]*"|'[^']*'|\S+/g)?.map(token => token.replace(/^['"]|['"]$/g, '')) ?? []
  if (tokens.length === 0) {
    throw new Error('bash command is blocked')
  }

  return { command: tokens[0], args: tokens.slice(1) }
}

function isCommandAllowed(command: string, args: string[]): boolean {
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

export function preValidateBashScope(
  input: BashToolInput,
  workspacePath: string,
  options: BashRunnerOptions = {},
): ToolScope {
  if (BLOCKED_TOKENS.some(token => (input.command || '').includes(token))) {
    try {
      parseCommands(input.command)
    }
    catch {
      return 'blocked'
    }
    return 'outside'
  }

  let commands: Array<{ command: string, args: string[] }>
  try {
    commands = parseCommands(input.command)
  }
  catch {
    return 'blocked'
  }
  if (commands.length === 0) {
    return 'blocked'
  }
  if (options.blockAgentBrowser && commands.some(isAgentBrowserCommand)) {
    return 'blocked'
  }

  let needsApproval = false
  for (const cmd of commands) {
    if (cmd.command === 'mkdir') {
      if (cmd.args.length < 2 || cmd.args[0] !== '-p') {
        needsApproval = true
      }
      else if (cmd.args.slice(1).some(a => hasObviousPathEscape(a))) {
        needsApproval = true
      }
      continue
    }
    if (!READ_ONLY_COMMANDS.has(cmd.command)) {
      needsApproval = true
      continue
    }
    if (cmd.args.some(a => hasObviousPathEscape(a))) {
      needsApproval = true
    }
  }

  const policy = createPathPolicyByMode(workspacePath, 'workspace')
  let cwd: string
  try {
    cwd = policy.resolveExisting(input.cwd || '.')
  }
  catch {
    return 'outside'
  }

  for (const cmd of commands) {
    if (cmd.command === 'mkdir') {
      for (const target of cmd.args.slice(1)) {
        const targetPath = path.resolve(cwd, target)
        if (!policy.isInsideWorkspace(targetPath)) {
          return 'outside'
        }
      }
    }
  }

  return needsApproval ? 'outside' : 'workspace'
}

function isAgentBrowserCommand(command: { command: string, args: string[] }): boolean {
  if (path.basename(command.command) === 'agent-browser') {
    return true
  }
  return path.basename(command.command) === 'npx'
    && command.args.includes('agent-browser')
}
