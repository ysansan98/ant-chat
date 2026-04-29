import type {
  AgentTool,
  AgentToolResult,
  AgentToolRisk,
  ApplyPatchToolInput,
  BashToolInput,
  GlobFilesToolInput,
  GrepFilesToolInput,
  ListDirToolInput,
  ReadFileToolInput,
  WriteFileToolInput,
} from '@ant-chat/shared'
import type { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { AGENT_POLICY_BLOCKED, AGENT_TOOL_EXEC_FAILED, WORKSPACE_INVALID_PATH } from '@ant-chat/shared'
import { WorkspaceStore } from '@main/store/workspace'
import { runBashTool } from './bashRunner'
import { createPathPolicyByMode } from './pathPolicy'

const DEFAULT_SEARCH_LIMIT = 100
const DEFAULT_LIST_DIR_LIMIT = 200
const MAX_LIST_DIR_LIMIT = 1000
const DEFAULT_EXCLUDED_DIRS = ['node_modules', '.git', 'dist', 'build']

type PatchOperation
  = | { type: 'add', filePath: string, content: string }
    | { type: 'delete', filePath: string }
    | { type: 'update', filePath: string, hunks: Array<{ oldText: string, newText: string, hasContext: boolean }> }

type PatchHunk = Extract<PatchOperation, { type: 'update' }>['hunks'][number]

export class NativeToolService {
  constructor(
    private readonly workspacePath = WorkspaceStore.getInstance().getCurrentWorkspacePath(),
    private readonly unrestricted: boolean = false,
  ) {}

  getTools(): AgentTool[] {
    return [
      this.createTool('read_file', () => 'L0', input => this.readFile(input as unknown as ReadFileToolInput)),
      this.createTool('list_dir', () => 'L0', input => this.listDir(input as unknown as ListDirToolInput)),
      this.createTool('glob_files', () => 'L0', input => this.globFiles(input as unknown as GlobFilesToolInput)),
      this.createTool('grep_files', () => 'L0', input => this.grepFiles(input as unknown as GrepFilesToolInput)),
      this.createTool('write_file', input => this.inferWriteFileRisk(input as unknown as WriteFileToolInput), input => this.writeFile(input as unknown as WriteFileToolInput)),
      this.createTool('apply_patch', input => this.inferApplyPatchRisk(input as unknown as ApplyPatchToolInput), input => this.applyPatch(input as unknown as ApplyPatchToolInput)),
      this.createTool('bash', input => this.inferBashRisk(input as unknown as BashToolInput), input => runBashTool(input as unknown as BashToolInput, this.workspacePath, this.unrestricted)),
    ]
  }

  private get pathPolicy() {
    return createPathPolicyByMode(this.workspacePath, this.unrestricted ? 'unrestricted' : 'workspace')
  }

  async readFile(input: ReadFileToolInput): Promise<AgentToolResult> {
    const filePath = this.pathPolicy.resolveExisting(input.path)
    const content = await fs.promises.readFile(filePath, 'utf8')
    const lines = content.split('\n')
    const startLine = Math.max(input.offset ?? 1, 1)
    const maxLines = Math.min(Math.max(input.limit ?? 200, 1), 2000)
    const totalLines = lines.length

    if (startLine > totalLines) {
      throw new Error(`READ_FILE_OFFSET_OUT_OF_RANGE: offset=${startLine} totalLines=${totalLines}`)
    }

    const selectedLines = lines.slice(startLine - 1, startLine - 1 + maxLines)
    const sliced = selectedLines.join('\n')
    const consumed = selectedLines.length
    const endLine = startLine + Math.max(consumed - 1, 0)
    const nextOffset = startLine + consumed
    const hasMore = nextOffset <= totalLines

    const header = `[Showing lines ${startLine}-${endLine} of ${totalLines}]`
    if (!hasMore) {
      return { ok: true, output: `${header}\n${sliced}` }
    }

    const remaining = totalLines - (nextOffset - 1)
    return {
      ok: true,
      output: `${header}\n${sliced}\n\n[${remaining} more lines. Use offset=${nextOffset} limit=${maxLines} to continue]`,
    }
  }

  async listDir(input: ListDirToolInput = {}): Promise<AgentToolResult> {
    const dirPath = this.pathPolicy.resolveExisting(input.path || '.')
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true })
    const sorted = entries
      .map(entry => ({
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'en'))
    const listDirInput = input as ListDirToolInput & { offset?: number, limit?: number }
    const offset = Math.max(listDirInput.offset ?? 0, 0)
    const limit = Math.min(Math.max(listDirInput.limit ?? DEFAULT_LIST_DIR_LIMIT, 1), MAX_LIST_DIR_LIMIT)
    const items = sorted.slice(offset, offset + limit)
    return {
      ok: true,
      output: {
        path: dirPath,
        offset,
        limit,
        total: sorted.length,
        hasMore: offset + items.length < sorted.length,
        items,
      },
    }
  }

  async globFiles(input: GlobFilesToolInput): Promise<AgentToolResult> {
    const cwd = this.pathPolicy.resolveExisting(input.path || '.')
    const limit = normalizeLimit(input.limit)
    const args = ['--files', '--no-ignore-global', '--glob', input.pattern, ...defaultExclusionGlobs(input.path)]
    const result = await runRg(args, cwd, limit)
    if (!result.ok) {
      return result
    }
    return { ...result, output: splitLimitedLines(result.stdout || '', limit) }
  }

  async grepFiles(input: GrepFilesToolInput): Promise<AgentToolResult> {
    const cwd = this.pathPolicy.resolveExisting(input.path || '.')
    const limit = normalizeLimit(input.limit)
    const args = ['--line-number', '--no-heading', '--no-ignore-global', ...defaultExclusionGlobs(input.path, input.include)]
    if (input.include) {
      args.push('--glob', input.include)
    }
    args.push(input.pattern)
    const result = await runRg(args, cwd, limit)
    if (!result.ok && result.exitCode !== 1) {
      return result
    }
    return { ...result, ok: true, output: splitLimitedLines(result.stdout || '', limit) }
  }

  async writeFile(input: WriteFileToolInput): Promise<AgentToolResult> {
    const filePath = this.pathPolicy.resolveForWrite(input.path)
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
    await fs.promises.writeFile(filePath, input.content, 'utf8')
    return { ok: true, output: { path: path.relative(this.workspacePath, filePath) } }
  }

  async applyPatch(input: ApplyPatchToolInput): Promise<AgentToolResult> {
    const policy = this.pathPolicy
    const operations = parsePatch(input.patch)
    const writes = new Map<string, string | null>()

    for (const operation of operations) {
      if (operation.type === 'add') {
        const filePath = policy.resolvePatchPath(operation.filePath, 'write')
        if (fs.existsSync(filePath)) {
          throw new Error(AGENT_TOOL_EXEC_FAILED)
        }
        writes.set(filePath, operation.content)
      }

      if (operation.type === 'delete') {
        const filePath = policy.resolvePatchPath(operation.filePath, 'existing')
        writes.set(filePath, null)
      }

      if (operation.type === 'update') {
        const filePath = policy.resolvePatchPath(operation.filePath, 'existing')
        let content = fs.readFileSync(filePath, 'utf8')

        for (const hunk of operation.hunks) {
          if (!hunk.hasContext || !content.includes(hunk.oldText)) {
            throw new Error(AGENT_TOOL_EXEC_FAILED)
          }
          content = content.replace(hunk.oldText, hunk.newText)
        }

        writes.set(filePath, content)
      }
    }

    const backups = new Map<string, string | null>()
    try {
      for (const [filePath] of writes.entries()) {
        backups.set(filePath, fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null)
      }

      for (const [filePath, content] of writes.entries()) {
        if (content === null) {
          await fs.promises.unlink(filePath)
        }
        else {
          await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
          await fs.promises.writeFile(filePath, content, 'utf8')
        }
      }
    }
    catch {
      for (const [filePath, backup] of backups.entries()) {
        if (backup === null) {
          if (fs.existsSync(filePath)) {
            await fs.promises.unlink(filePath)
          }
          continue
        }
        await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
        await fs.promises.writeFile(filePath, backup, 'utf8')
      }
      throw new Error(AGENT_TOOL_EXEC_FAILED)
    }

    return { ok: true, output: { changedFiles: writes.size } }
  }

  private createTool(name: string, inferRisk: AgentTool['inferRisk'], execute: AgentTool['execute']): AgentTool {
    return {
      name,
      source: 'native',
      inferRisk,
      execute: async (input) => {
        try {
          return await execute(input)
        }
        catch (error) {
          if (error instanceof Error && error.message === WORKSPACE_INVALID_PATH) {
            return {
              ok: false,
              error: this.unrestricted
                ? AGENT_TOOL_EXEC_FAILED
                : `${AGENT_POLICY_BLOCKED}: path outside workspace`,
            }
          }
          return { ok: false, error: error instanceof Error ? error.message : AGENT_TOOL_EXEC_FAILED }
        }
      },
    }
  }

  private inferWriteFileRisk(input: WriteFileToolInput): AgentToolRisk {
    const filePath = this.pathPolicy.resolveForWrite(input.path)
    return fs.existsSync(filePath) ? 'L2' : 'L1'
  }

  private inferApplyPatchRisk(input: ApplyPatchToolInput): AgentToolRisk {
    let operations: PatchOperation[]
    try {
      operations = parsePatch(input.patch)
    }
    catch {
      return 'L2'
    }
    if (operations.some(operation => operation.type === 'delete')) {
      return 'L2'
    }
    if (operations.length >= 5) {
      return 'L2'
    }
    if (operations.some(operation => /(?:^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|package\.json|tsconfig.*\.json)$/.test(operation.filePath))) {
      return 'L2'
    }
    return 'L1'
  }

  private inferBashRisk(input: BashToolInput): AgentToolRisk {
    const [command, ...args] = input.command.trim().split(/\s+/)
    if (['pwd', 'ls', 'cat', 'rg', 'find'].includes(command) || (command === 'mkdir' && args[0] === '-p' && args.length >= 2)) {
      return 'L1'
    }
    return 'L2'
  }
}

export function getNativeToolService(workspacePath?: string, unrestricted: boolean = false): NativeToolService {
  return new NativeToolService(workspacePath, unrestricted)
}

function normalizeLimit(limit: number | undefined): number {
  return Math.min(Math.max(limit ?? DEFAULT_SEARCH_LIMIT, 1), DEFAULT_SEARCH_LIMIT)
}

function defaultExclusionGlobs(inputPath?: string, include?: string): string[] {
  const explicitPath = inputPath?.split(/[\\/]/).filter(Boolean)[0]
  const explicitIncludePath = include?.split(/[\\/]/).filter(Boolean)[0]
  return DEFAULT_EXCLUDED_DIRS.includes(explicitPath || '')
    || DEFAULT_EXCLUDED_DIRS.includes(explicitIncludePath || '')
    ? []
    : DEFAULT_EXCLUDED_DIRS.flatMap(dir => ['--glob', `!${dir}/**`])
}

async function runRg(args: string[], cwd: string, limit: number): Promise<AgentToolResult> {
  const startedAt = Date.now()
  const command = resolveRgCommand()
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, shell: false })
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
        error: code === 'ENOENT' ? AGENT_TOOL_EXEC_FAILED : (error.message || AGENT_TOOL_EXEC_FAILED),
        durationMs: Date.now() - startedAt,
      })
    })
    child.on('close', (exitCode) => {
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

function splitLimitedLines(stdout: string, limit: number): string[] {
  return stdout.split('\n').filter(Boolean).slice(0, limit)
}

function parsePatch(patch: string): PatchOperation[] {
  const lines = patch.replace(/\r\n/g, '\n').split('\n')
  if (lines.at(-1) === '') {
    lines.pop()
  }
  if (lines[0] !== '*** Begin Patch' || lines.at(-1) !== '*** End Patch') {
    throw new Error(AGENT_TOOL_EXEC_FAILED)
  }

  const operations: PatchOperation[] = []
  let index = 1
  while (index < lines.length - 1) {
    const line = lines[index]
    if (line.startsWith('*** Add File: ')) {
      const filePath = line.slice('*** Add File: '.length)
      index += 1
      const contentLines: string[] = []
      while (index < lines.length - 1 && !lines[index].startsWith('*** ')) {
        if (!lines[index].startsWith('+')) {
          throw new Error(AGENT_TOOL_EXEC_FAILED)
        }
        contentLines.push(lines[index].slice(1))
        index += 1
      }
      operations.push({ type: 'add', filePath, content: `${contentLines.join('\n')}\n` })
      continue
    }

    if (line.startsWith('*** Delete File: ')) {
      operations.push({ type: 'delete', filePath: line.slice('*** Delete File: '.length) })
      index += 1
      continue
    }

    if (line.startsWith('*** Update File: ')) {
      const filePath = line.slice('*** Update File: '.length)
      index += 1
      const hunks: PatchHunk[] = []

      while (index < lines.length - 1 && !lines[index].startsWith('*** ')) {
        if (lines[index] !== '@@') {
          throw new Error(AGENT_TOOL_EXEC_FAILED)
        }
        index += 1

        const oldLines: string[] = []
        const newLines: string[] = []
        let hasContext = false
        while (index < lines.length - 1 && lines[index] !== '@@' && !lines[index].startsWith('*** ')) {
          const patchLine = lines[index]
          if (patchLine.startsWith(' ')) {
            const value = patchLine.slice(1)
            oldLines.push(value)
            newLines.push(value)
            hasContext = true
          }
          else if (patchLine.startsWith('-')) {
            oldLines.push(patchLine.slice(1))
          }
          else if (patchLine.startsWith('+')) {
            newLines.push(patchLine.slice(1))
          }
          else {
            throw new Error(AGENT_TOOL_EXEC_FAILED)
          }
          index += 1
        }

        hunks.push({
          oldText: `${oldLines.join('\n')}\n`,
          newText: `${newLines.join('\n')}\n`,
          hasContext,
        })
      }

      operations.push({ type: 'update', filePath, hunks })
      continue
    }

    throw new Error(AGENT_TOOL_EXEC_FAILED)
  }

  if (operations.length === 0) {
    throw new Error(AGENT_TOOL_EXEC_FAILED)
  }

  return operations
}
