import type { AgentToolResult } from '@ant-chat/shared'
import type { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { AGENT_TOOL_EXEC_FAILED } from '@ant-chat/shared'

const DEFAULT_SEARCH_LIMIT = 100
const DEFAULT_EXCLUDED_DIRS = ['node_modules', '.git', 'dist', 'build']

export function normalizeSearchLimit(limit: number | undefined): number {
  return Math.min(Math.max(limit ?? DEFAULT_SEARCH_LIMIT, 1), DEFAULT_SEARCH_LIMIT)
}

export function defaultExclusionGlobs(inputPath?: string, include?: string): string[] {
  const explicitPath = inputPath?.split(/[\\/]/).filter(Boolean)[0]
  const explicitIncludePath = include?.split(/[\\/]/).filter(Boolean)[0]
  return DEFAULT_EXCLUDED_DIRS.includes(explicitPath || '')
    || DEFAULT_EXCLUDED_DIRS.includes(explicitIncludePath || '')
    ? []
    : DEFAULT_EXCLUDED_DIRS.flatMap(dir => ['--glob', `!${dir}/**`])
}

export async function runRg(args: string[], cwd: string, limit: number): Promise<AgentToolResult> {
  const startedAt = Date.now()
  const command = resolveRgCommand()
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk: Buffer) => {
      stdout = appendUntilLines(stdout, chunk.toString(), limit)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', (error) => {
      const code = (error as NodeJS.ErrnoException).code
      resolve({
        ok: false,
        error: code === 'ENOENT' ? `rg 命令不可用 (${error.message || 'spawn ENOENT'})` : (error.message || AGENT_TOOL_EXEC_FAILED),
        durationMs: Date.now() - startedAt,
      })
    })
    child.on('close', (exitCode) => {
      const code = exitCode ?? undefined
      resolve({
        ok: exitCode === 0,
        stdout,
        stderr,
        exitCode: code,
        error: exitCode === 0 ? undefined : (stderr.trim() || `rg exited with code ${code}`),
        durationMs: Date.now() - startedAt,
      })
    })
  })
}

export function splitLimitedLines(stdout: string, limit: number): string[] {
  return stdout.split('\n').filter(Boolean).slice(0, limit)
}

function resolveRgCommand(): string {
  const platformArch = `${process.platform}-${process.arch}`
  const executable = process.platform === 'win32' ? 'rg.exe' : 'rg'
  const candidates: string[] = []

  if (typeof process.resourcesPath === 'string' && process.resourcesPath.length > 0) {
    candidates.push(path.join(process.resourcesPath, 'rg', platformArch, executable))
  }
  candidates.push(path.resolve(process.cwd(), 'resources', 'rg', platformArch, executable))

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) {
      continue
    }
    if (process.platform !== 'win32') {
      try {
        fs.chmodSync(candidate, 0o755)
      }
      catch {
        // ignore chmod failure and still try to execute the binary
      }
    }
    return candidate
  }

  return 'rg'
}

function appendUntilLines(current: string, next: string, limit: number): string {
  const value = current + next
  const lines = value.split('\n')
  return lines.length > limit ? lines.slice(0, limit).join('\n') : value
}
