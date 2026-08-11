import type { WorkspaceDirectoryListing } from '@ant-chat/shared'
import { Button } from '@workspace/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { Input } from '@workspace/ui/components/input'
import {
  ChevronRightIcon,
  FolderIcon,
  FolderPlusIcon,
  HomeIcon,
  Loader2Icon,
  SearchIcon,
  XIcon,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import workspaceApi from '@/api/workspaceApi'

interface WorkspaceDirectoryPickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (path: string) => void
  title?: string
  description?: string
  confirmLabel?: string
  allowCreateDirectory?: boolean
}

export function WorkspaceDirectoryPickerDialog({
  open,
  onOpenChange,
  onConfirm,
  title = '选择工作区',
  description = '浏览并选择一个目录作为工作区。',
  confirmLabel = '添加工作区',
  allowCreateDirectory = true,
}: WorkspaceDirectoryPickerDialogProps) {
  const [listing, setListing] = useState<WorkspaceDirectoryListing | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [creating, setCreating] = useState(false)
  const [filter, setFilter] = useState('')
  const filterInputRef = useRef<HTMLInputElement>(null)
  const newFolderInputRef = useRef<HTMLInputElement>(null)
  /** 键盘导航高亮索引，相对 filteredDirectories；进入新目录后归零 */
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const resetFormState = useCallback(() => {
    setFilter('')
    setShowNewFolder(false)
    setNewFolderName('')
  }, [])

  const loadDirectory = useCallback(async (path?: string) => {
    setLoading(true)
    setError(null)
    resetFormState()
    try {
      const data = await workspaceApi.listDirectories(path)
      setListing(data)
      setSelectedPath(data.currentPath)
      setHighlightedIndex(0)
    }
    catch (err) {
      setError((err as Error).message)
    }
    finally {
      setLoading(false)
    }
  }, [resetFormState])

  const filteredDirectories = useMemo(() => {
    if (!listing)
      return []
    if (!filter.trim())
      return listing.directories
    const keyword = filter.trim().toLowerCase()
    return listing.directories.filter(dir => dir.name.toLowerCase().includes(keyword))
  }, [listing, filter])

  // 过滤结果收缩后索引可能越界，统一用夹取后的安全索引驱动交互与视觉
  const safeHighlightedIndex = Math.min(highlightedIndex, Math.max(filteredDirectories.length - 1, 0))

  // 键盘移动后把高亮项滚入视野
  useEffect(() => {
    const activeItem = listRef.current?.querySelector('[data-highlighted="true"]')
    activeItem?.scrollIntoView({ block: 'nearest' })
  }, [safeHighlightedIndex, filteredDirectories])

  const moveHighlight = useCallback((delta: number) => {
    const count = filteredDirectories.length
    if (count === 0) {
      return
    }

    // 当前 index 对应的项若不在选中态（例如刚进入子目录），方向键先落到最近端点
    const current = filteredDirectories[safeHighlightedIndex]
    const hasActiveHighlight = current !== undefined && current.path === selectedPath
    const nextIndex = hasActiveHighlight
      ? Math.min(Math.max(safeHighlightedIndex + delta, 0), count - 1)
      : delta > 0
        ? 0
        : count - 1

    setHighlightedIndex(nextIndex)
    setSelectedPath(filteredDirectories[nextIndex].path)
  }, [filteredDirectories, safeHighlightedIndex, selectedPath])

  const handleConfirm = useCallback(() => {
    if (selectedPath) {
      onConfirm(selectedPath)
    }
  }, [selectedPath, onConfirm])

  // 键盘导航挂到 window 捕获阶段：Base UI Dialog 会在内部拦截 keydown 的
  // 冒泡阶段（stopPropagation），且目录切换可能让焦点短暂丢失到 body；
  // 捕获阶段监听不依赖焦点位置、也不受子元素拦截影响，保证切目录后按键仍然有效
  useEffect(() => {
    if (!open) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      // 新建文件夹输入框有自己的 Enter/Escape 语义，不参与目录导航
      if (newFolderInputRef.current === event.target) {
        return
      }

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault()
          moveHighlight(1)
          return
        case 'ArrowUp':
          event.preventDefault()
          moveHighlight(-1)
          return
        case 'ArrowLeft': {
          // 搜索框有文字时 ←/→ 留给光标移动（编辑搜索词），空时用于目录导航
          const editingSearch = event.target === filterInputRef.current && filter.length > 0
          if (!editingSearch && listing?.parentPath) {
            event.preventDefault()
            void loadDirectory(listing.parentPath)
          }
          return
        }
        case 'ArrowRight': {
          const editingSearch = event.target === filterInputRef.current && filter.length > 0
          if (editingSearch) {
            return
          }
          // 进入当前高亮目录（等价右键/双击）
          const target = filteredDirectories[safeHighlightedIndex]
          if (target) {
            event.preventDefault()
            void loadDirectory(target.path)
          }
          return
        }
        case 'Tab': {
          // 进入当前高亮目录（等价右键/双击）
          const target = filteredDirectories[safeHighlightedIndex]
          if (target) {
            event.preventDefault()
            void loadDirectory(target.path)
          }
          return
        }
        case 'Enter': {
          // 焦点在 filter input 时回车 = 添加当前目录；列表/按钮保持默认点击行为
          if (event.target === filterInputRef.current && selectedPath) {
            event.preventDefault()
            handleConfirm()
          }
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [open, filteredDirectories, safeHighlightedIndex, listing, selectedPath, filter, moveHighlight, loadDirectory, handleConfirm])

  useEffect(() => {
    if (open) {
      void loadDirectory()
      requestAnimationFrame(() => filterInputRef.current?.focus())
    }
  }, [open, loadDirectory])

  useEffect(() => {
    if (showNewFolder && newFolderInputRef.current) {
      newFolderInputRef.current.focus()
    }
  }, [showNewFolder])

  function handleNavigate(path: string) {
    void loadDirectory(path)
  }

  function handleSelect(path: string) {
    setSelectedPath(path)
  }

  function handleDoubleClick(path: string) {
    void loadDirectory(path)
  }

  function handleBreadcrumbClick(index: number, segments: string[]) {
    const target = `/${segments.slice(0, index + 1).join('/')}`
    void loadDirectory(target)
  }

  async function handleCreateFolder() {
    if (!newFolderName.trim() || !listing) {
      return
    }

    setCreating(true)
    setError(null)
    try {
      const created = await workspaceApi.createDirectory(listing.currentPath, newFolderName.trim())
      setNewFolderName('')
      setShowNewFolder(false)
      void loadDirectory(created.path)
    }
    catch (err) {
      setError((err as Error).message)
    }
    finally {
      setCreating(false)
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setListing(null)
      setSelectedPath(null)
      setError(null)
      setShowNewFolder(false)
      setNewFolderName('')
      setFilter('')
    }
    onOpenChange(nextOpen)
  }

  const breadcrumbSegments = listing
    ? listing.currentPath.split('/').filter(Boolean)
    : []

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[70vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="shrink-0 border-b px-4 py-3">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden px-4 py-3">
          {/* Breadcrumb and navigation */}
          <div className="flex shrink-0 items-center gap-1">
            {listing?.roots.map(root => (
              <Button
                key={root}
                variant="ghost"
                size="icon-xs"
                disabled={loading}
                onClick={() => handleNavigate(root)}
                title={root}
              >
                <HomeIcon className="size-3.5" />
              </Button>
            ))}

            <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto text-sm text-muted-foreground">
              {breadcrumbSegments.map((segment, index) => (
                <span key={`/${breadcrumbSegments.slice(0, index + 1).join('/')}`} className="flex items-center gap-0.5">
                  {index > 0 && <ChevronRightIcon className="size-3 shrink-0" />}
                  <button
                    type="button"
                    className="shrink-0 truncate hover:text-foreground"
                    disabled={loading}
                    onClick={() => handleBreadcrumbClick(index, breadcrumbSegments)}
                  >
                    {index === 0 ? '/' : segment}
                  </button>
                </span>
              ))}
            </div>

            {listing?.parentPath && (
              <Button
                variant="ghost"
                size="xs"
                disabled={loading}
                onClick={() => handleNavigate(listing.parentPath!)}
              >
                ..
              </Button>
            )}
          </div>

          {/* Filter input */}
          <div className="relative shrink-0">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={filterInputRef}
              value={filter}
              onChange={(e) => {
                // loading 期间禁止输入，但不 disabled：disabled 会强制失焦导致键盘导航中断
                if (!loading) {
                  setFilter(e.target.value)
                }
              }}
              placeholder="搜索目录..."
              className="h-8 px-8 text-sm"
            />
            {filter && (
              <button
                type="button"
                className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setFilter('')}
              >
                <XIcon className="size-3.5" />
              </button>
            )}
          </div>

          {/* Directory list */}
          <div ref={listRef} className="h-60 overflow-y-auto rounded-md border">
            {loading
              ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
                  </div>
                )
              : filteredDirectories.length
                ? (
                    filteredDirectories.map((dir, index) => (
                      <button
                        key={dir.path}
                        type="button"
                        data-highlighted={index === safeHighlightedIndex}
                        className={`
                          flex h-8 w-full items-center gap-2 px-3 text-sm
                          hover:bg-accent hover:text-accent-foreground
                          ${selectedPath === dir.path
                        ? 'bg-accent font-medium text-accent-foreground'
                        : ''}
                        `}
                        onClick={() => {
                          setHighlightedIndex(index)
                          handleSelect(dir.path)
                        }}
                        onDoubleClick={() => handleDoubleClick(dir.path)}
                      >
                        <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">{dir.name}</span>
                      </button>
                    ))
                  )
                : (
                    <EmptyState title={filter ? '无匹配目录' : '暂无目录'} />
                  )}
          </div>
          {/* 键盘快捷键说明 */}
          <div className="shrink-0 px-1 text-xs text-muted-foreground">
            ↑↓ 选择 · ← 返回上级 · → 进入目录 · Enter 添加 · Tab 进入 · 搜索输入时 ←→ 移动光标
          </div>

          {/* New folder input */}
          {allowCreateDirectory && showNewFolder && (
            <div className="flex shrink-0 items-center gap-2">
              <Input
                ref={newFolderInputRef}
                value={newFolderName}
                onChange={e => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    void handleCreateFolder()
                  }
                  if (e.key === 'Escape') {
                    setShowNewFolder(false)
                    setNewFolderName('')
                  }
                }}
                placeholder="文件夹名称"
                disabled={creating}
                className="h-8 flex-1"
              />
              <Button
                size="sm"
                disabled={!newFolderName.trim() || creating}
                onClick={handleCreateFolder}
              >
                {creating
                  ? <Loader2Icon className="size-4 animate-spin" />
                  : '创建'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={creating}
                onClick={() => {
                  setShowNewFolder(false)
                  setNewFolderName('')
                }}
              >
                取消
              </Button>
            </div>
          )}

          {/* Error display */}
          {error && (
            <div className="shrink-0 text-sm text-destructive">{error}</div>
          )}
        </div>

        {/* Footer: override built-in -mx-4 -mb-4 p-4 to avoid overflow */}
        <div className="flex shrink-0 flex-row items-center justify-between border-t border-border/70 bg-muted/50 px-4 py-3">
          {allowCreateDirectory
            ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={loading}
                  onClick={() => setShowNewFolder(true)}
                >
                  <FolderPlusIcon className="size-4" />
                  新建文件夹
                </Button>
              )
            : <span />}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
            >
              取消
            </Button>
            <Button
              disabled={!selectedPath || loading}
              onClick={handleConfirm}
            >
              {confirmLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
