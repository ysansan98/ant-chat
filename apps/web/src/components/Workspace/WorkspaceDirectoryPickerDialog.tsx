import type { WorkspaceDirectoryListing } from '@ant-chat/shared'
import { Button } from '@workspace/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog'
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
}

export function WorkspaceDirectoryPickerDialog({
  open,
  onOpenChange,
  onConfirm,
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

  function handleConfirm() {
    if (selectedPath) {
      onConfirm(selectedPath)
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
          <DialogTitle>选择工作区</DialogTitle>
          <DialogDescription>
            浏览并选择一个目录作为工作区。
          </DialogDescription>
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
              onChange={e => setFilter(e.target.value)}
              placeholder="搜索目录..."
              disabled={loading}
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
          <div className="h-60 overflow-y-auto rounded-md border">
            {loading
              ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
                  </div>
                )
              : filteredDirectories.length
                ? (
                    filteredDirectories.map(dir => (
                      <button
                        key={dir.path}
                        type="button"
                        className={`
                          flex h-8 w-full items-center gap-2 px-3 text-sm
                          hover:bg-accent hover:text-accent-foreground
                          ${selectedPath === dir.path
                        ? 'bg-accent font-medium text-accent-foreground'
                        : ''}
                        `}
                        onClick={() => handleSelect(dir.path)}
                        onDoubleClick={() => handleDoubleClick(dir.path)}
                      >
                        <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">{dir.name}</span>
                      </button>
                    ))
                  )
                : (
                    <div className="py-8 text-center text-sm text-muted-foreground">
                      {filter ? '无匹配目录' : '暂无目录'}
                    </div>
                  )}
          </div>

          {/* New folder input */}
          {showNewFolder && (
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
            <div className="shrink-0 text-sm text-red-500">{error}</div>
          )}
        </div>

        {/* Footer: override built-in -mx-4 -mb-4 p-4 to avoid overflow */}
        <div className="flex shrink-0 flex-row items-center justify-between border-t border-border/70 bg-muted/50 px-4 py-3">
          <Button
            variant="ghost"
            size="sm"
            disabled={loading}
            onClick={() => setShowNewFolder(true)}
          >
            <FolderPlusIcon className="size-4" />
            新建文件夹
          </Button>
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
              添加工作区
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
