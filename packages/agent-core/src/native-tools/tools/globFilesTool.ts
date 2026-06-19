import type { AgentToolResult, GlobFilesToolInput } from '@ant-chat/shared'
import type { PathPolicy } from '../pathPolicy'
import { defaultExclusionGlobs, normalizeSearchLimit, runRg, splitLimitedLines } from './rgRunner'
import { createNativeTool } from './toolFactory'

export async function globFiles(input: GlobFilesToolInput, pathPolicy: PathPolicy): Promise<AgentToolResult> {
  const cwd = pathPolicy.resolveExisting(input.path || '.')
  const limit = normalizeSearchLimit(input.limit)
  const args = ['--files', '--no-ignore-global', '--glob', input.pattern, ...defaultExclusionGlobs(input.path)]
  const result = await runRg(args, cwd, limit)
  if (!result.ok && result.diagnostics?.exitCode !== 1) {
    return result
  }
  return {
    ok: true,
    result: splitLimitedLines(result.diagnostics?.stdout || '', limit).join('\n'),
    diagnostics: result.diagnostics,
  }
}

export function createGlobFilesTool(pathPolicy: PathPolicy, unrestricted: boolean) {
  return createNativeTool({
    name: 'glob_files',
    description: 'Find files by glob pattern. Does not support {a,b} brace expansion. By default excludes node_modules, .git, dist, build. To search inside those directories, pass an explicit path argument pointing to them.',
    inputSchema: {
      type: 'object',
      properties: { pattern: { type: 'string' }, path: { type: 'string' }, limit: { type: 'number' } },
      required: ['pattern'],
    },
    unrestricted,
    inferScope: input => pathPolicy.classifyAccess(String((input as unknown as GlobFilesToolInput).path || '.')),
    validateInput: validateGlobInput,
    execute: input => globFiles(input as unknown as GlobFilesToolInput, pathPolicy),
  })
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
