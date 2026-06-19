import type { AgentToolResult, ListDirToolInput } from '@ant-chat/shared'
import type { PathPolicy } from '../pathPolicy'
import fs from 'node:fs'
import { createNativeTool } from './toolFactory'

const DEFAULT_LIST_DIR_LIMIT = 200
const MAX_LIST_DIR_LIMIT = 1000

export async function listDir(input: ListDirToolInput = {}, pathPolicy: PathPolicy): Promise<AgentToolResult> {
  const dirPath = pathPolicy.resolveExisting(input.path || '.')
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
  const output = {
    path: dirPath,
    offset,
    limit,
    total: sorted.length,
    hasMore: offset + items.length < sorted.length,
    items,
  }
  const itemsText = items.map(i => `${i.type === 'directory' ? '[dir]' : '[file]'} ${i.name}`).join('\n') || '(空)'
  return {
    ok: true,
    result: [
      `path=${output.path}, offset=${output.offset}, total=${output.total}, returned=${output.items.length}, hasMore=${output.hasMore}`,
      itemsText,
    ].join('\n'),
    diagnostics: {
      data: output,
    },
  }
}

export function createListDirTool(pathPolicy: PathPolicy, unrestricted: boolean) {
  return createNativeTool({
    name: 'list_dir',
    description: '列出目录内容，支持 offset/limit 分页',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' }, offset: { type: 'number' }, limit: { type: 'number' } },
      required: [],
    },
    unrestricted,
    inferScope: input => pathPolicy.classifyAccess(String((input as unknown as ListDirToolInput).path || '.')),
    execute: input => listDir(input as unknown as ListDirToolInput, pathPolicy),
    truncateResult: false,
  })
}
