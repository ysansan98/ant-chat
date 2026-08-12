import type { WorkspaceTreeEntry } from '@ant-chat/shared'
import { cn } from '@workspace/ui/lib/utils'
import { ChevronRightIcon, FileIcon, FolderIcon, FolderOpenIcon, Loader2Icon } from 'lucide-react'
import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import workspaceApi from '@/api/workspaceApi'
import { toErrorMessage } from '@/utils/util'

interface FileTreeProps {
  workspacePath: string
  selectedPath: string | null
  /** 需要定位展开的目录 relPath（含其祖先目录）；变化时自动展开并滚动到可见 */
  revealPath?: string | null
  onSelectFile: (entry: WorkspaceTreeEntry) => void
}

/** 目录 relPath → 已加载的直接子条目（目录在前，文件在后） */
type EntriesByPath = Record<string, WorkspaceTreeEntry[]>

/**
 * 工作区文件树（懒加载）。
 * 根目录 relPath 约定为空串 ''；展开目录时按需调用 listDirectoryEntries。
 * requestId 守卫保证工作区切换 / 快速展开时旧请求的结果不会覆盖新状态。
 *
 * 缩进通过递归嵌套实现：子目录容器统一 pl-3.5（14px），自然累加层级缩进，
 * 无需 depth 参数或内联 paddingLeft。
 */
export function FileTree({ workspacePath, selectedPath, revealPath, onSelectFile }: FileTreeProps) {
  const [entriesByPath, setEntriesByPath] = useState<EntriesByPath>({})
  const [loadingPaths, setLoadingPaths] = useState<Record<string, boolean>>({})
  const [errorByPath, setErrorByPath] = useState<Record<string, string>>({})
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set(['']))
  const requestIdRef = useRef(0)
  // reveal 链加载使用独立请求域，避免与目录切换/根目录加载互相作废
  const revealRequestIdRef = useRef(0)
  // 异步展开链期间读取最新已加载状态，避免闭包拿到旧快照重复请求
  const entriesByPathRef = useRef(entriesByPath)
  const loadingPathsRef = useRef(loadingPaths)

  useEffect(() => {
    entriesByPathRef.current = entriesByPath
  }, [entriesByPath])

  useEffect(() => {
    loadingPathsRef.current = loadingPaths
  }, [loadingPaths])

  const loadDirectory = useCallback(async (dirPath: string, requestId: number) => {
    setLoadingPaths(prev => ({ ...prev, [dirPath]: true }))
    setErrorByPath(prev => omitKey(prev, dirPath))
    try {
      const { dirs, files } = await workspaceApi.listDirectoryEntries(
        workspacePath,
        dirPath || undefined,
      )
      if (requestId !== requestIdRef.current) {
        return
      }
      setEntriesByPath(prev => ({ ...prev, [dirPath]: [...dirs, ...files] }))
    }
    catch (cause) {
      if (requestId !== requestIdRef.current) {
        return
      }
      setErrorByPath(prev => ({ ...prev, [dirPath]: toErrorMessage(cause) }))
    }
    finally {
      if (requestId === requestIdRef.current) {
        setLoadingPaths(prev => ({ ...prev, [dirPath]: false }))
      }
    }
  }, [workspacePath])

  // 工作区切换时重置树并加载根目录
  useEffect(() => {
    const requestId = ++requestIdRef.current
    revealRequestIdRef.current += 1
    setEntriesByPath({})
    setErrorByPath({})
    setLoadingPaths({})
    setExpandedPaths(new Set(['']))
    void loadDirectory('', requestId)
  }, [workspacePath, loadDirectory])

  /** 定位展开时的目录加载：独立请求域，不会被文件树常规操作作废 */
  const loadChainDirectory = useCallback(async (dirPath: string) => {
    const requestId = ++revealRequestIdRef.current
    setLoadingPaths(prev => ({ ...prev, [dirPath]: true }))
    try {
      const { dirs, files } = await workspaceApi.listDirectoryEntries(
        workspacePath,
        dirPath || undefined,
      )
      if (requestId !== revealRequestIdRef.current) {
        return
      }
      setEntriesByPath(prev => ({ ...prev, [dirPath]: [...dirs, ...files] }))
    }
    catch (cause) {
      if (requestId !== revealRequestIdRef.current) {
        return
      }
      setErrorByPath(prev => ({ ...prev, [dirPath]: toErrorMessage(cause) }))
    }
    finally {
      if (requestId === revealRequestIdRef.current) {
        setLoadingPaths(prev => ({ ...prev, [dirPath]: false }))
      }
    }
  }, [workspacePath])

  // 定位展开：把 revealPath 的每一级祖先目录依次展开（必要时先加载），最后滚动到目标
  useEffect(() => {
    if (!revealPath) {
      return
    }
    const chain = revealPath.split('/').filter(Boolean)
    if (chain.length === 0) {
      return
    }
    let cancelled = false
    let scrollTimer: ReturnType<typeof setTimeout> | undefined
    void (async () => {
      for (const dir of chain) {
        if (cancelled) {
          return
        }
        setExpandedPaths(prev => (prev.has(dir) ? prev : new Set(prev).add(dir)))
        if (!entriesByPathRef.current[dir] && !loadingPathsRef.current[dir]) {
          await loadChainDirectory(dir)
        }
      }
      if (cancelled) {
        return
      }
      // 等 DOM 提交后再滚动，确保目标行已渲染
      scrollTimer = setTimeout(() => {
        const target = chain.at(-1)!
        const row = [...document.querySelectorAll<HTMLElement>('[data-tree-rel-path]')]
          .find(el => el.dataset.treeRelPath === target)
        row?.scrollIntoView?.({ block: 'nearest' })
      }, 0)
    })()
    return () => {
      cancelled = true
      if (scrollTimer !== undefined) {
        clearTimeout(scrollTimer)
      }
    }
  }, [revealPath, loadChainDirectory])

  function toggleDirectory(dirPath: string) {
    const isExpanded = expandedPaths.has(dirPath)
    setExpandedPaths((prev) => {
      const next = new Set(prev)
      if (isExpanded) {
        next.delete(dirPath)
      }
      else {
        next.add(dirPath)
      }
      return next
    })
    if (!isExpanded && !entriesByPath[dirPath] && !loadingPaths[dirPath]) {
      void loadDirectory(dirPath, ++requestIdRef.current)
    }
  }

  function renderDirectory(entry: WorkspaceTreeEntry) {
    const isExpanded = expandedPaths.has(entry.relPath)
    const isLoading = loadingPaths[entry.relPath]
    return (
      <Fragment key={entry.relPath}>
        <button
          type="button"
          data-tree-rel-path={entry.relPath}
          className="flex w-full min-w-0 items-center gap-1.5 rounded-md py-1 pr-2 pl-1.5 text-left text-sm text-foreground/85 transition-colors hover:bg-accent"
          aria-expanded={isExpanded}
          onClick={() => toggleDirectory(entry.relPath)}
        >
          <ChevronRightIcon
            className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', isExpanded && 'rotate-90')}
          />
          {isExpanded
            ? <FolderOpenIcon className="size-4 shrink-0 text-primary/80" />
            : <FolderIcon className="size-4 shrink-0 text-muted-foreground" />}
          <span className="truncate">{entry.name}</span>
        </button>
        {/* 子条目容器：pl-3.5（14px）自然累加层级缩进 */}
        {isExpanded && (
          <div className="pl-3.5">
            {isLoading
              ? <LoadingRow />
              : errorByPath[entry.relPath]
                ? <ErrorRow message={errorByPath[entry.relPath]} />
                : renderEntries(entry.relPath)}
          </div>
        )}
      </Fragment>
    )
  }

  function renderFile(entry: WorkspaceTreeEntry) {
    const selected = selectedPath === entry.relPath
    return (
      <button
        type="button"
        key={entry.relPath}
        data-tree-rel-path={entry.relPath}
        className={cn(
          'flex w-full min-w-0 items-center gap-1.5 rounded-md py-1 pr-2 pl-6.5 text-left text-sm transition-colors',
          selected
            ? 'bg-accent font-medium text-accent-foreground'
            : 'text-foreground/85 hover:bg-accent',
        )}
        onClick={() => onSelectFile(entry)}
      >
        <FileIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{entry.name}</span>
      </button>
    )
  }

  function renderEntries(dirPath: string) {
    const entries = entriesByPath[dirPath]
    if (!entries || entries.length === 0) {
      return <div className="py-1 pl-5 text-xs text-muted-foreground">空目录</div>
    }
    return entries.map(entry =>
      entry.type === 'directory'
        ? renderDirectory(entry)
        : renderFile(entry),
    )
  }

  const rootEntries = entriesByPath['']

  return (
    <div className="py-1">
      {loadingPaths[''] && !rootEntries
        ? <LoadingRow />
        : errorByPath['']
          ? <ErrorRow message={errorByPath['']} />
          : renderEntries('')}
    </div>
  )
}

function LoadingRow() {
  return (
    <div
      className="flex items-center gap-1.5 py-1 pl-5 text-xs text-muted-foreground"
      data-testid="file-tree-loading"
    >
      <Loader2Icon className="size-3.5 animate-spin" />
      加载中…
    </div>
  )
}

function ErrorRow({ message }: { message: string }) {
  return (
    <div className="py-1 pl-5 text-xs text-destructive">
      {message}
    </div>
  )
}

function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) {
    return record
  }
  const next = { ...record }
  delete next[key]
  return next
}
