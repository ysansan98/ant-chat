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

export function createReadFileTool(pathPolicy: PathPolicy, unrestricted: boolean) {
  return createNativeTool({
    name: 'read_file',
    unrestricted,
    inferScope: input => pathPolicy.classifyAccess(String((input as unknown as ReadFileToolInput).path || '.')),
    execute: input => readFile(input as unknown as ReadFileToolInput, pathPolicy),
  })
}
