import type { AgentToolResult, ReadFileToolInput } from '@ant-chat/shared'
import type { PathPolicy } from '../pathPolicy'
import fs from 'node:fs'
import { createNativeTool } from './toolFactory'

export async function readFile(input: ReadFileToolInput, pathPolicy: PathPolicy): Promise<AgentToolResult> {
  const filePath = pathPolicy.resolveExisting(input.path)
  const content = await fs.promises.readFile(filePath, 'utf8')
  const lines = content.split('\n')
  const startLine = Math.max(input.offset ?? 1, 1)
  const maxLines = Math.min(Math.max(input.limit ?? 2000, 1), 2000)
  const totalLines = lines.length

  if (startLine > totalLines) {
    throw new Error(`READ_FILE_OFFSET_OUT_OF_RANGE: offset=${startLine} totalLines=${totalLines}`)
  }

  const selectedLines = lines.slice(startLine - 1, startLine - 1 + maxLines)
  const consumed = selectedLines.length
  const endLine = startLine + Math.max(consumed - 1, 0)
  const nextOffset = startLine + consumed
  const hasMore = nextOffset <= totalLines

  const padding = String(endLine).length
  const numberedLines = selectedLines.map((line, i) =>
    `${String(startLine + i).padStart(padding)}\t${line}`)
  const sliced = numberedLines.join('\n')

  const header = `[Showing lines ${startLine}-${endLine} of ${totalLines}]`
  if (!hasMore) {
    return { ok: true, result: `${header}\n${sliced}` }
  }

  const remaining = totalLines - (nextOffset - 1)
  return {
    ok: true,
    result: `${header}\n${sliced}\n\n[${remaining} more lines. Use offset=${nextOffset} limit=${maxLines} to continue]`,
  }
}

export function createReadFileTool(pathPolicy: PathPolicy, unrestricted: boolean) {
  return createNativeTool({
    name: 'read_file',
    description: '读取文件内容，输出带 cat -n 风格行号（行号对应实际文件行号）。offset 为起始行号(1-based)，limit 为读取行数',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' }, offset: { type: 'number' }, limit: { type: 'number' } },
      required: ['path'],
    },
    unrestricted,
    inferScope: input => pathPolicy.classifyAccess(String((input as unknown as ReadFileToolInput).path || '.')),
    execute: input => readFile(input as unknown as ReadFileToolInput, pathPolicy),
    truncateResult: false,
  })
}
