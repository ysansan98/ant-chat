import type { AgentToolResult, GrepFilesToolInput } from '@ant-chat/shared'
import type { PathPolicy } from '../pathPolicy'
import { defaultExclusionGlobs, normalizeSearchLimit, runRg, splitLimitedLines } from './rgRunner'
import { createNativeTool } from './toolFactory'

export async function grepFiles(input: GrepFilesToolInput, pathPolicy: PathPolicy): Promise<AgentToolResult> {
  const cwd = pathPolicy.resolveExisting(input.path || '.')
  const limit = normalizeSearchLimit(input.limit)
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

export function createGrepFilesTool(pathPolicy: PathPolicy, unrestricted: boolean) {
  return createNativeTool({
    name: 'grep_files',
    description: '按正则搜索文件内容',
    inputSchema: {
      type: 'object',
      properties: { pattern: { type: 'string' }, path: { type: 'string' }, include: { type: 'string' }, limit: { type: 'number' } },
      required: ['pattern'],
    },
    unrestricted,
    inferScope: input => pathPolicy.classifyAccess(String((input as unknown as GrepFilesToolInput).path || '.')),
    execute: input => grepFiles(input as unknown as GrepFilesToolInput, pathPolicy),
  })
}
