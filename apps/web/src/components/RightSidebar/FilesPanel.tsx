import type { WorkspaceFileSearchResult, WorkspaceTreeEntry } from '@ant-chat/shared'
import type { FileTabView, MarkdownMode } from './FileContentArea'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@workspace/ui/components/input-group'
import { Spinner } from '@workspace/ui/components/spinner'
import { cn } from '@workspace/ui/lib/utils'
import {
  FileIcon,
  FolderTreeIcon,
  PanelLeftOpenIcon,
  PanelRightCloseIcon,
  SearchIcon,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import workspaceApi from '@/api/workspaceApi'
import { useWorkspaceStore } from '@/store/workspace'
import { FileTree } from '../Workspace/FileTree'
import { FileContentArea, FileHeader, NoFileSelectedState } from './FileContentArea'
import { ResizeHandle } from './ResizeHandle'

type SearchStatus = 'idle' | 'loading' | 'ready' | 'error'

const SEARCH_DEBOUNCE_MS = 200
const SEARCH_LIMIT = 50
const TREE_WIDTH_KEY = 'ant-chat:right-sidebar-tree-width'
const DEFAULT_TREE_WIDTH = 220
const MIN_TREE_WIDTH = 152
const MAX_TREE_WIDTH = 600

export interface FilesPanelProps {
  /** 当前激活的文件标签（内容镜像） */
  activeFile: WorkspaceTreeEntry | null
  activeFileView: FileTabView | null
  /** 需要定位展开的目录（来自面包屑/搜索结果） */
  revealPath: string | null
  onModeChange: (mode: MarkdownMode) => void
  onOpenFile: (entry: WorkspaceTreeEntry) => void
  onRevealDir: (dirPath: string) => void
  onOpenWithDefaultApp: (file: WorkspaceTreeEntry) => void
}

/**
 * 右侧栏「文件」页签：文件管理器视图。
 * 左侧内容区与文件标签页共用 FileContentArea（面包屑并入头部）；
 * 右侧文件树支持整体收起/展开、文件名模糊搜索（走后端 searchWorkspaceFiles），
 * 工具栏提供「用默认软件打开当前文件」与「文件树开关」。
 */
export function FilesPanel({
  activeFile,
  activeFileView,
  revealPath,
  onModeChange,
  onOpenFile,
  onRevealDir,
  onOpenWithDefaultApp,
}: FilesPanelProps) {
  const workspacePath = useWorkspaceStore(state => state.currentWorkspacePath)
  const [treeVisible, setTreeVisible] = useState(true)
  const [treeWidth, setTreeWidth] = useState(loadSavedTreeWidth)
  const [filterQuery, setFilterQuery] = useState('')
  const [searchResults, setSearchResults] = useState<WorkspaceFileSearchResult[] | null>(null)
  const [searchStatus, setSearchStatus] = useState<SearchStatus>('idle')
  const [searchError, setSearchError] = useState('')
  const requestIdRef = useRef(0)

  const filterActive = filterQuery.trim() !== ''

  useEffect(() => {
    try {
      window.localStorage.setItem(TREE_WIDTH_KEY, String(treeWidth))
    }
    catch {
      // localStorage 不可用时忽略，仅本次会话内有效
    }
  }, [treeWidth])

  // 工作区切换时清空搜索并作废进行中的请求
  useEffect(() => {
    requestIdRef.current += 1
    setFilterQuery('')
    setSearchResults(null)
    setSearchStatus('idle')
  }, [workspacePath])

  // 文件名模糊搜索（防抖；清空关键字时回到文件树）
  useEffect(() => {
    const query = filterQuery.trim()
    if (!workspacePath || !query) {
      setSearchResults(null)
      setSearchStatus('idle')
      return
    }
    const requestId = ++requestIdRef.current
    setSearchStatus('loading')
    const timer = setTimeout(async () => {
      try {
        const results = await workspaceApi.searchWorkspaceFiles(workspacePath, query, SEARCH_LIMIT)
        if (requestId !== requestIdRef.current) {
          return
        }
        setSearchResults(results)
        setSearchStatus('ready')
      }
      catch (cause) {
        if (requestId !== requestIdRef.current) {
          return
        }
        setSearchError(toErrorMessage(cause))
        setSearchStatus('error')
      }
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [filterQuery, workspacePath])

  if (!workspacePath) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center" data-testid="files-panel">
        <EmptyState
          icon={<FolderTreeIcon />}
          title="未选择工作区"
          description="请先在左侧选择或添加一个工作区"
        />
      </div>
    )
  }

  function handleSearchFile(item: WorkspaceFileSearchResult) {
    onOpenFile({ name: item.name, relPath: item.path, type: 'file' })
    setFilterQuery('')
    onRevealDir(parentDirOf(item.path))
  }

  function handleSearchDir(item: WorkspaceFileSearchResult) {
    setFilterQuery('')
    onRevealDir(item.path)
  }

  const treeToggleButton = (
    <button
      type="button"
      className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      onClick={() => setTreeVisible(visible => !visible)}
      aria-label={treeVisible ? '隐藏文件树' : '显示文件树'}
    >
      {treeVisible ? <PanelRightCloseIcon className="size-4" /> : <PanelLeftOpenIcon className="size-4" />}
    </button>
  )

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="files-panel">
      {/* 全宽头部：面包屑 + 右对齐操作（模式切换 / 用默认软件打开 / 文件树开关） */}
      <FileHeader
        file={activeFile}
        view={activeFileView}
        workspaceName={workspaceNameOf(workspacePath)}
        onNavigateDir={onRevealDir}
        onModeChange={onModeChange}
        onOpenWithDefaultApp={activeFile ? onOpenWithDefaultApp : undefined}
        headerExtra={treeToggleButton}
      />
      <div className="flex min-h-0 min-w-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {activeFile && activeFileView
            ? (
                <FileContentArea
                  file={activeFile}
                  view={activeFileView}
                  workspaceName={workspaceNameOf(workspacePath)}
                  onNavigateDir={onRevealDir}
                  onModeChange={onModeChange}
                  onOpenWithDefaultApp={onOpenWithDefaultApp}
                  hideHeader
                />
              )
            : <NoFileSelectedState />}
        </div>
        {treeVisible && (
          <div
            className="relative flex shrink-0 flex-col border-l border-border/60"
            style={{ width: treeWidth, minWidth: MIN_TREE_WIDTH, maxWidth: '60%' }}
            data-testid="file-tree-column"
          >
            <ResizeHandle width={treeWidth} minWidth={MIN_TREE_WIDTH} maxWidth={MAX_TREE_WIDTH} onWidthChange={setTreeWidth} />
            <div className="p-2 pb-1">
              <InputGroup>
                <InputGroupAddon>
                  <SearchIcon className="size-4" />
                </InputGroupAddon>
                <InputGroupInput
                  value={filterQuery}
                  onChange={event => setFilterQuery(event.target.value)}
                  placeholder="过滤文件名…"
                  aria-label="过滤文件名"
                />
              </InputGroup>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {filterActive
                ? (
                    <SearchResults
                      status={searchStatus}
                      results={searchResults ?? []}
                      error={searchError}
                      onSelectFile={handleSearchFile}
                      onSelectDir={handleSearchDir}
                    />
                  )
                : (
                    <FileTree
                      workspacePath={workspacePath}
                      selectedPath={activeFile?.relPath ?? null}
                      revealPath={revealPath}
                      onSelectFile={onOpenFile}
                    />
                  )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function loadSavedTreeWidth(): number {
  try {
    const raw = window.localStorage.getItem(TREE_WIDTH_KEY)
    const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
    return Number.isFinite(parsed) ? Math.max(MIN_TREE_WIDTH, Math.min(MAX_TREE_WIDTH, parsed)) : DEFAULT_TREE_WIDTH
  }
  catch {
    return DEFAULT_TREE_WIDTH
  }
}

function SearchResults({ status, results, error, onSelectFile, onSelectDir }: {
  status: SearchStatus
  results: WorkspaceFileSearchResult[]
  error: string
  onSelectFile: (item: WorkspaceFileSearchResult) => void
  onSelectDir: (item: WorkspaceFileSearchResult) => void
}) {
  if (status === 'loading') {
    return <div className="flex justify-center py-4" data-testid="file-search-loading"><Spinner /></div>
  }
  if (status === 'error') {
    return <p className="px-3 py-2 text-xs text-destructive">{error}</p>
  }
  if (status === 'ready' && results.length === 0) {
    return <p className="px-3 py-2 text-xs text-muted-foreground">没有匹配的文件</p>
  }
  return (
    <div className="py-1" data-testid="file-search-results">
      {results.map(item => (
        <button
          type="button"
          key={item.path}
          className={cn(
            'flex w-full min-w-0 items-center gap-1.5 rounded-md px-2 py-1 pr-2 text-left text-xs text-foreground/85 transition-colors hover:bg-accent/60',
          )}
          onClick={() => (item.type === 'file' ? onSelectFile(item) : onSelectDir(item))}
        >
          {item.type === 'file'
            ? <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
            : <FolderTreeIcon className="size-3.5 shrink-0 text-muted-foreground" />}
          <span className="truncate">{item.name}</span>
          <span className="ml-auto shrink-0 truncate font-mono text-muted-foreground">{item.path}</span>
        </button>
      ))}
    </div>
  )
}

function parentDirOf(relPath: string): string {
  const index = relPath.lastIndexOf('/')
  return index >= 0 ? relPath.slice(0, index) : ''
}

function workspaceNameOf(workspacePath: string): string {
  return workspacePath ? (workspacePath.split('/').filter(Boolean).pop() ?? workspacePath) : ''
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
