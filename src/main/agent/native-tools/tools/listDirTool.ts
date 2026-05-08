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

export function createListDirTool(pathPolicy: PathPolicy, unrestricted: boolean) {
  return createNativeTool({
    name: 'list_dir',
    unrestricted,
    inferScope: input => pathPolicy.classifyAccess(String((input as unknown as ListDirToolInput).path || '.')),
    execute: input => listDir(input as unknown as ListDirToolInput, pathPolicy),
  })
}
