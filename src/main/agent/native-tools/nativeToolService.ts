import type {
  AgentTool,
  AgentToolResult,
  ApplyPatchToolInput,
  BashToolInput,
  GlobFilesToolInput,
  GrepFilesToolInput,
  ListDirToolInput,
  ReadFileToolInput,
  ToolOperationType,
  ToolScope,
  WriteFileToolInput,
} from '@ant-chat/shared'
import type { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { AGENT_POLICY_BLOCKED, AGENT_TOOL_EXEC_FAILED, WORKSPACE_INVALID_PATH } from '@ant-chat/shared'
import { WorkspaceStore } from '@main/store/workspace'
import { preValidateBashScope, runBashTool } from './bashRunner'
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
      this.createTool('read_file', input => this.pathPolicy.classifyAccess(String((input as unknown as ReadFileToolInput).path || '.')), input => this.readFile(input as unknown as ReadFileToolInput)),
      this.createTool('list_dir', input => this.pathPolicy.classifyAccess(String((input as unknown as ListDirToolInput).path || '.')), input => this.listDir(input as unknown as ListDirToolInput)),
      this.createTool('glob_files', input => this.pathPolicy.classifyAccess(String((input as unknown as GlobFilesToolInput).path || '.')), input => this.globFiles(input as unknown as GlobFilesToolInput), validateGlobInput),
      this.createTool('grep_files', input => this.pathPolicy.classifyAccess(String((input as unknown as GrepFilesToolInput).path || '.')), input => this.grepFiles(input as unknown as GrepFilesToolInput)),
      this.createTool('write_file', input => this.pathPolicy.classifyAccess((input as unknown as WriteFileToolInput).path), input => this.writeFile(input as unknown as WriteFileToolInput)),
      this.createTool('apply_patch', input => this.inferPatchScope(input as unknown as ApplyPatchToolInput), input => this.applyPatch(input as unknown as ApplyPatchToolInput)),
      this.createTool('bash', input => preValidateBashScope(input as unknown as BashToolInput, this.workspacePath), input => runBashTool(input as unknown as BashToolInput, this.workspacePath, this.unrestricted)),
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
    if (!result.ok && result.exitCode !== 1) {
      return result
    }
    return { ...result, ok: true, output: splitLimitedLines(result.stdout || '', limit) }
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
          throw new Error(`apply_patch 失败：Add File 操作的目标文件已存在 "${operation.filePath}"`)
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
            throw new Error(`apply_patch 失败：Update File "${operation.filePath}" 中的 hunk 匹配失败，oldText 在当前文件内容中未找到`)
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
    catch (err) {
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
      throw new Error(`apply_patch 失败：文件写入异常，已回滚所有更改。原因: ${err instanceof Error ? err.message : '未知错误'}`)
    }

    return { ok: true, output: { changedFiles: writes.size } }
  }

  private createTool(name: string, inferScope: AgentTool['inferScope'], execute: AgentTool['execute'], validateInput?: AgentTool['validateInput']): AgentTool {
    return {
      name,
      source: 'native',
      operationType: getToolOperationType(name),
      inferScope,
      validateInput,
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

  private inferPatchScope(input: ApplyPatchToolInput): ToolScope {
    try {
      const operations = parsePatch(input.patch)
      for (const op of operations) {
        if (this.pathPolicy.classifyAccess(op.filePath) === 'outside') {
          return 'outside'
        }
      }
      return 'workspace'
    }
    catch {
      return 'blocked'
    }
  }
}

function getToolOperationType(name: string): ToolOperationType {
  switch (name) {
    case 'read_file': case 'list_dir': case 'glob_files': case 'grep_files':
      return 'read'
    case 'write_file': case 'apply_patch':
      return 'write'
    case 'bash':
      return 'bash'
    default:
      return 'read'
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

function validateGlobInput(input: Record<string, unknown>): string | null {
  const pattern = typeof input.pattern === 'string' ? input.pattern : ''
  if (!pattern) {
    return 'glob_files 参数错误：pattern 不能为空'
  }
  if (/\{[^}]+\}/.test(pattern)) {
    return `glob_files 参数错误：pattern "${pattern}" 包含 shell brace expansion 语法 {a,b}，但 rg --glob 不支持该语法。请拆分为多次调用或使用字符类 [[...]] 等替代语法`
  }
  return null
}

function parsePatch(patch: string): PatchOperation[] {
  const lines = patch.replace(/\r\n/g, '\n').split('\n')
  if (lines.at(-1) === '') {
    lines.pop()
  }
  if (lines[0] !== '*** Begin Patch' || lines.at(-1) !== '*** End Patch') {
    throw new Error('apply_patch 参数错误：patch 必须以 "*** Begin Patch" 开头且以 "*** End Patch" 结尾')
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
          throw new Error('apply_patch 格式错误：Add File 内容行必须以 \'+\' 开头')
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
          throw new Error('apply_patch 格式错误：Update File 的 hunk 必须以 \'@@\' 标记开始')
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
            throw new Error('apply_patch 格式错误：hunk 内每行必须以 \' \'、\'-\' 或 \'+\' 开头')
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

    throw new Error('apply_patch 格式错误：未知的 patch 操作类型，期望 \'*** Add File:\' / \'*** Delete File:\' / \'*** Update File:\'')
  }

  if (operations.length === 0) {
    throw new Error('apply_patch 格式错误：patch 未包含任何有效操作')
  }

  return operations
}
