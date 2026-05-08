import type { WorkspaceFileSearchResult } from '@ant-chat/shared'
import fs from 'node:fs'
import path from 'node:path'

const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'out',
  'dist',
  'build',
  'release',
])

const DEFAULT_LIMIT = 50
const MAX_VISITED_ENTRIES = 5000

export async function searchWorkspaceFiles(
  workspacePath: string,
  query = '',
  limit = DEFAULT_LIMIT,
): Promise<WorkspaceFileSearchResult[]> {
  const root = path.resolve(workspacePath)
  const normalizedQuery = query.trim().toLowerCase()
  const maxResults = Math.max(1, Math.min(limit, 100))
  const results: WorkspaceFileSearchResult[] = []
  let visited = 0

  async function walk(dir: string): Promise<void> {
    if (results.length >= maxResults || visited >= MAX_VISITED_ENTRIES) {
      return
    }

    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true })
    }
    catch {
      return
    }

    entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))

    for (const entry of entries) {
      if (results.length >= maxResults || visited >= MAX_VISITED_ENTRIES) {
        return
      }
      visited += 1

      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) {
          await walk(path.join(dir, entry.name))
        }
        continue
      }

      if (!entry.isFile()) {
        continue
      }

      const absolutePath = path.join(dir, entry.name)
      const relativePath = path.relative(root, absolutePath).split(path.sep).join('/')
      if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        continue
      }
      if (normalizedQuery && !relativePath.toLowerCase().includes(normalizedQuery)) {
        continue
      }

      results.push({
        path: relativePath,
        name: entry.name,
        type: 'file',
      })
    }
  }

  await walk(root)
  return results
}
