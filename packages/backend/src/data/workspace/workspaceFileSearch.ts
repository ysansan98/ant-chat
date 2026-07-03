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
/** 目录结果子限额：避免目录挤占文件名额，目录只作为钻取入口 */
const DIRECTORY_LIMIT = 20

interface QueryPlan {
  /** 目录前缀，限制搜索范围。空串表示从根搜索 */
  scope: string
  /** 搜索关键词。空串表示浏览模式（列出 scope 下直接子目录 + 所有文件） */
  keyword: string
}

/**
 * 解析 query 为搜索计划。
 *
 * 三种模式：
 * 1. 浏览模式（keyword 为空）：列出 scope 下的直接子目录 + 所有文件
 *    - query 为空 → 浏览根目录
 *    - query 带尾斜杠（`packages/`）→ 浏览该目录
 *    - query 指向已存在目录（`packages`）→ 自动进入
 *
 * 2. scope 下模糊搜索模式：scope 是已存在目录，keyword 非空
 *    - `packages/runtime` → scope='packages', keyword='runtime'
 *    - 匹配 scope 下 basename 含 keyword 的目录 + 路径含 keyword 的文件（含子孙）
 *
 * 3. 全局模糊搜索模式：scope 不存在，keyword = 整个 query
 *    - `xyz` → scope='', keyword='xyz'
 *    - 匹配 basename 含 keyword 的目录 + 路径含 keyword 的文件
 */
async function resolveQueryPlan(query: string, root: string): Promise<QueryPlan> {
  const normalized = query.trim()

  // 空查询：浏览根目录
  if (!normalized) {
    return { scope: '', keyword: '' }
  }

  // 禁止向上遍历（防止 @../etc 越界读取工作区外文件）
  if (normalized.split('/').includes('..')) {
    return { scope: '', keyword: normalized }
  }

  // 带尾斜杠：浏览该目录
  if (normalized.endsWith('/')) {
    return { scope: normalized.replace(/\/$/, ''), keyword: '' }
  }

  // 按最后一个 / 拆分 scope + keyword
  const slashIdx = normalized.lastIndexOf('/')
  if (slashIdx >= 0) {
    const scope = normalized.slice(0, slashIdx)
    const keyword = normalized.slice(slashIdx + 1)
    if (scope) {
      try {
        const stat = await fs.promises.stat(path.join(root, scope))
        if (stat.isDirectory()) {
          return { scope, keyword }
        }
      }
      catch {
        // scope 不是目录，回退全局
      }
    }
  }

  // 回退：全局搜索
  return { scope: '', keyword: normalized }
}

/** 判断 relPath 是否在 scope 下（不含 scope 自身） */
function underScope(relPath: string, scope: string): boolean {
  if (!scope) {
    return true
  }
  if (relPath === scope) {
    return false
  }
  return relPath.startsWith(`${scope}/`)
}

/** 获取 basename（posix） */
function basename(relPath: string): string {
  const idx = relPath.lastIndexOf('/')
  return idx >= 0 ? relPath.slice(idx + 1) : relPath
}

/** 获取 parent（posix 路径，根目录下返回空串） */
function parentOf(relPath: string): string {
  const idx = relPath.lastIndexOf('/')
  return idx >= 0 ? relPath.slice(0, idx) : ''
}

export async function searchWorkspaceFiles(
  workspacePath: string,
  query = '',
  limit = DEFAULT_LIMIT,
): Promise<WorkspaceFileSearchResult[]> {
  const root = path.resolve(workspacePath)
  const plan = await resolveQueryPlan(query, root)
  const { scope, keyword } = plan
  const lowerKeyword = keyword.toLowerCase()

  const maxResults = Math.max(1, Math.min(limit, 100))
  const dirLimit = Math.min(DIRECTORY_LIMIT, maxResults)
  const fileLimit = maxResults

  // 浏览模式：keyword 为空，列直接子目录 + 所有文件
  // 模糊搜索模式：keyword 非空，basename/path 含 keyword 的子孙
  const isBrowseMode = !keyword

  function matchDirectory(relPath: string): boolean {
    if (!underScope(relPath, scope)) {
      return false
    }
    if (isBrowseMode) {
      // 浏览模式只列直接子目录
      return parentOf(relPath) === scope
    }
    // 模糊搜索：basename 含 keyword
    return basename(relPath).toLowerCase().includes(lowerKeyword)
  }

  function matchFile(relPath: string): boolean {
    if (!underScope(relPath, scope)) {
      return false
    }
    if (isBrowseMode) {
      return true
    }
    return relPath.toLowerCase().includes(lowerKeyword)
  }

  const dirResults: WorkspaceFileSearchResult[] = []
  const fileResults: WorkspaceFileSearchResult[] = []
  let visited = 0

  async function walk(dir: string): Promise<void> {
    if (dirResults.length >= dirLimit && fileResults.length >= fileLimit) {
      return
    }
    if (visited >= MAX_VISITED_ENTRIES) {
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
      if (dirResults.length >= dirLimit && fileResults.length >= fileLimit) {
        return
      }
      if (visited >= MAX_VISITED_ENTRIES) {
        return
      }
      visited += 1

      if (entry.isDirectory()) {
        const absolutePath = path.join(dir, entry.name)
        const relativePath = path.relative(root, absolutePath).split(path.sep).join('/')

        // 被忽略目录（node_modules/dist 等）仍作为可钻取入口出现在结果中，
        // 但不自动下钻（性能保护）。用户主动进入（scope 指向该目录）时，
        // walk 从该目录起始，其下内容正常可见。
        if (
          !relativePath.startsWith('..')
          && !path.isAbsolute(relativePath)
          && dirResults.length < dirLimit
          && matchDirectory(relativePath)
        ) {
          dirResults.push({
            path: relativePath,
            name: entry.name,
            type: 'directory',
          })
        }

        // 被忽略目录不自动下钻，避免扫描 node_modules 等大目录
        if (!IGNORED_DIRS.has(entry.name)) {
          await walk(absolutePath)
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

      if (fileResults.length < fileLimit && matchFile(relativePath)) {
        fileResults.push({
          path: relativePath,
          name: entry.name,
          type: 'file',
        })
      }
    }
  }

  // scope 非空时从 scope 目录开始遍历，避免遍历无关子树
  const startDir = scope ? path.join(root, scope) : root
  await walk(startDir)

  // 目录优先，各自内部按 path 字母序稳定排序
  dirResults.sort((a, b) => a.path.localeCompare(b.path, 'en'))
  fileResults.sort((a, b) => a.path.localeCompare(b.path, 'en'))

  const trimmedDirs = dirResults.slice(0, dirLimit)
  const trimmedFiles = fileResults.slice(0, Math.max(0, maxResults - trimmedDirs.length))
  return [...trimmedDirs, ...trimmedFiles]
}
