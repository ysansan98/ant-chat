import type { AgentToolResult, WriteFileToolInput } from '@ant-chat/shared'
import type { PathPolicy } from '../pathPolicy'
import fs from 'node:fs'
import path from 'node:path'
import { createNativeTool } from './toolFactory'

export async function writeFile(input: WriteFileToolInput, pathPolicy: PathPolicy, workspacePath: string): Promise<AgentToolResult> {
  const filePath = pathPolicy.resolveForWrite(input.path)
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
  await fs.promises.writeFile(filePath, input.content, 'utf8')
  return { ok: true, output: { path: path.relative(fs.realpathSync.native(workspacePath), filePath), absolutePath: filePath } }
}

export function createWriteFileTool(pathPolicy: PathPolicy, workspacePath: string, unrestricted: boolean) {
  return createNativeTool({
    name: 'write_file',
    description: '写入文件内容',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
    },
    unrestricted,
    inferScope: input => pathPolicy.classifyAccess((input as unknown as WriteFileToolInput).path),
    execute: input => writeFile(input as unknown as WriteFileToolInput, pathPolicy, workspacePath),
    formatObservation: (result) => {
      const output = result.output as { path: string, absolutePath?: string } | undefined
      const displayPath = output?.absolutePath ?? output?.path ?? 'unknown'
      return `path=${displayPath}. File state is current in context; no read-back is required.`
    },
  })
}
