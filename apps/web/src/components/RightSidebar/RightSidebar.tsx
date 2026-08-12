import type { WorkspaceTreeEntry } from '@ant-chat/shared'
import type { FileTabView, MarkdownMode } from './FileContentArea'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu'
import { Sheet, SheetContent } from '@workspace/ui/components/sheet'
import { cn } from '@workspace/ui/lib/utils'
import {
  ActivityIcon,
  FileTextIcon,
  FolderTreeIcon,
  PlusIcon,
  XIcon,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import workspaceApi from '@/api/workspaceApi'
import { useWorkspaceStore } from '@/store/workspace'
import { ExecutionTracePanel } from '../ExecutionTrace'
import { FilesPanel } from './FilesPanel'
import { isMarkdownFileName } from './fileView'
import { ResizeHandle } from './ResizeHandle'

export type SidebarTabKind = 'files' | 'trace'

interface SidebarTab {
  id: string
  kind: SidebarTabKind
}

export interface RightSidebarProps {
  open: boolean
  conversationId?: string
  focusTurnId?: string
  onClose: () => void
}

const NARROW_QUERY = '(max-width: 767px)'
const WIDTH_STORAGE_KEY = 'ant-chat:right-sidebar-width'
const DEFAULT_PANEL_WIDTH = 520
const MIN_PANEL_WIDTH = 360

/**
 * 统一右侧辅助栏：标签页模型（文件管理 / Trace）。
 * - 默认无标签，居中展示「文件 / Trace」两个入口；
 * - 文件管理标签支持多个（+ → 文件 新建），Trace 唯一；选中文件后该标签显示文件名；
 * - 文件树与内容同屏（内容左、树右），树开关在头部，打开文件不隐藏文件树；
 * - 标签栏右侧 + 入口可选择文件/Trace；收起开关固定在标签行右端（窗口右上角）。
 * 文件管理页签保持挂载（hidden 隐藏），切换标签不丢树状态。
 */
export function RightSidebar({
  open,
  conversationId,
  focusTurnId,
  onClose,
}: RightSidebarProps) {
  const narrow = useMediaQuery(NARROW_QUERY)
  const [width, setWidth] = useState(loadSavedWidth)
  const workspacePath = useWorkspaceStore(state => state.currentWorkspacePath)
  const [tabs, setTabs] = useState<SidebarTab[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  /** 每个文件管理标签当前打开的文件（key 为标签 id；无文件时不存） */
  const [fileViews, setFileViews] = useState<Record<string, FileTabView>>({})
  /** 每个文件管理标签需要定位展开的目录（key 为标签 id） */
  const [filesRevealMap, setFilesRevealMap] = useState<Record<string, string | null>>({})
  const fileRequestIdsRef = useRef<Record<string, number>>({})
  const nextFilesTabIdRef = useRef(1)

  useEffect(() => {
    try {
      window.localStorage.setItem(WIDTH_STORAGE_KEY, String(width))
    }
    catch {
      // localStorage 不可用时忽略，仅本次会话内有效
    }
  }, [width])

  // 工作区切换时清空文件内容与标签，并作废进行中的读取
  useEffect(() => {
    fileRequestIdsRef.current = {}
    setFileViews({})
    setTabs([])
    setActiveId(null)
    setFilesRevealMap({})
  }, [workspacePath])

  // 从消息跳转 Trace：打开时自动加入并激活 Trace 标签
  useEffect(() => {
    if (!open || !focusTurnId) {
      return
    }
    setTabs(current => current.some(tab => tab.kind === 'trace')
      ? current
      : [...current, { id: 'trace', kind: 'trace' }])
    setActiveId('trace')
  }, [open, focusTurnId])

  const loadFileContent = useCallback(async (tabId: string, relPath: string) => {
    const key = `${tabId}:${relPath}`
    const requestId = (fileRequestIdsRef.current[key] ?? 0) + 1
    fileRequestIdsRef.current[key] = requestId
    try {
      const content = await workspaceApi.readTextFile(workspacePath, relPath)
      if (fileRequestIdsRef.current[key] !== requestId) {
        return
      }
      setFileViews((prev) => {
        const current = prev[tabId]
        return current?.file.relPath === relPath ? { ...prev, [tabId]: { ...current, status: 'ready', content } } : prev
      })
    }
    catch (cause) {
      if (fileRequestIdsRef.current[key] !== requestId) {
        return
      }
      setFileViews((prev) => {
        const current = prev[tabId]
        return current?.file.relPath === relPath ? { ...prev, [tabId]: { ...current, status: 'error', error: toErrorMessage(cause) } } : prev
      })
    }
  }, [workspacePath])

  /** 打开文件：在当前激活的文件管理标签中展示（标签显示文件名），文件树保持可见；失败时可重试 */
  const openFile = useCallback((entry: WorkspaceTreeEntry) => {
    const tabId = activeId
    if (!tabId) {
      return
    }
    const current = fileViews[tabId]
    if (current?.file.relPath === entry.relPath) {
      if (current.status === 'error') {
        setFileViews(prev => ({ ...prev, [tabId]: { file: entry, status: 'loading', mode: current.mode } }))
        void loadFileContent(tabId, entry.relPath)
      }
      return
    }
    setFileViews(prev => ({
      ...prev,
      [tabId]: {
        file: entry,
        status: 'loading',
        mode: isMarkdownFileName(entry.name) ? 'preview' : 'source',
      },
    }))
    void loadFileContent(tabId, entry.relPath)
  }, [activeId, fileViews, loadFileContent])

  /** 新建文件管理标签（支持多个），并激活 */
  const createFilesTab = useCallback(() => {
    const id = `files:${nextFilesTabIdRef.current++}`
    setTabs(current => [...current, { id, kind: 'files' }])
    setActiveId(id)
  }, [])

  /** 打开/跳转唯一 Trace 标签 */
  const activateTrace = useCallback(() => {
    const existing = tabs.find(tab => tab.kind === 'trace')
    if (existing) {
      setActiveId(existing.id)
      return
    }
    setTabs(current => [...current, { id: 'trace', kind: 'trace' }])
    setActiveId('trace')
  }, [tabs])

  const selectTab = useCallback((id: string) => {
    setActiveId(id)
  }, [])

  const closeTab = useCallback((id: string) => {
    const index = tabs.findIndex(tab => tab.id === id)
    if (index === -1) {
      return
    }
    const remaining = tabs.filter(tab => tab.id !== id)
    setTabs(remaining)
    if (activeId === id) {
      const neighbor = remaining[Math.min(index, remaining.length - 1)]
      setActiveId(neighbor ? neighbor.id : null)
    }
    setFileViews((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    setFilesRevealMap((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }, [tabs, activeId])

  const handleModeChange = useCallback((tabId: string, mode: MarkdownMode) => {
    setFileViews((prev) => {
      const current = prev[tabId]
      return current ? { ...prev, [tabId]: { ...current, mode } } : prev
    })
  }, [])

  /** 面包屑目录点击：在所属文件管理标签中定位展开目录 */
  const handleRevealDir = useCallback((tabId: string, dirPath: string) => {
    setFilesRevealMap(prev => ({ ...prev, [tabId]: dirPath }))
  }, [])

  const handleOpenWithDefaultApp = useCallback(async (file: WorkspaceTreeEntry) => {
    if (!workspacePath) {
      return
    }
    try {
      await workspaceApi.openWithDefaultApp(workspacePath, file.relPath)
    }
    catch (cause) {
      toast.error(toErrorMessage(cause))
    }
  }, [workspacePath])

  const activeTab = tabs.find(tab => tab.id === activeId) ?? null

  const content = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <TabStrip
        tabs={tabs}
        activeId={activeId}
        fileViews={fileViews}
        onSelect={selectTab}
        onClose={closeTab}
        onAddFiles={createFilesTab}
        onAddTrace={activateTrace}
      />
      {tabs.length === 0
        ? (
            <EmptyStateView
              onOpenFiles={createFilesTab}
              onOpenTrace={activateTrace}
            />
          )
        : (
            <>
              {/* 每个文件管理标签一个实例（非激活隐藏，保持各自树/文件状态） */}
              {tabs.filter(tab => tab.kind === 'files').map((tab) => {
                const fileView = fileViews[tab.id] ?? null
                return (
                  <div key={tab.id} className={cn('flex min-h-0 flex-1 flex-col', activeTab?.id !== tab.id && 'hidden')}>
                    <FilesPanel
                      activeFile={fileView?.file ?? null}
                      activeFileView={fileView}
                      revealPath={filesRevealMap[tab.id] ?? null}
                      onModeChange={mode => handleModeChange(tab.id, mode)}
                      onOpenFile={openFile}
                      onRevealDir={dirPath => handleRevealDir(tab.id, dirPath)}
                      onOpenWithDefaultApp={handleOpenWithDefaultApp}
                    />
                  </div>
                )
              })}
              {activeTab?.kind === 'trace' && (
                <div className="flex min-h-0 flex-1 flex-col">
                  <ExecutionTracePanel conversationId={conversationId} focusTurnId={focusTurnId} isOpen />
                </div>
              )}
            </>
          )}
    </div>
  )

  if (narrow) {
    if (!open) {
      return null
    }
    return (
      <Sheet open onOpenChange={openChange => !openChange && onClose()}>
        <SheetContent
          className="w-screen max-w-none gap-0 p-0 data-[side=right]:w-screen data-[side=right]:max-w-none"
          showCloseButton={narrow}
        >
          {content}
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <aside
      className={cn(
        'relative flex h-full shrink-0 flex-col overflow-hidden border-l border-border bg-background transition-[width,opacity,visibility] duration-300',
        open ? 'shadow-xl' : 'pointer-events-none invisible border-l-transparent opacity-0 shadow-none',
      )}
      style={{ width: open ? width : 0, minWidth: 0, maxWidth: '80vw' }}
      aria-label="右侧辅助栏"
      aria-hidden={!open}
    >
      <ResizeHandle width={width} minWidth={MIN_PANEL_WIDTH} maxWidth={window.innerWidth * 0.8} onWidthChange={setWidth} />
      {content}
    </aside>
  )
}

function TabStrip({ tabs, activeId, fileViews, onSelect, onClose, onAddFiles, onAddTrace }: {
  tabs: SidebarTab[]
  activeId: string | null
  /** 每个文件管理标签当前打开的文件（key 为标签 id） */
  fileViews: Record<string, FileTabView>
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onAddFiles: () => void
  onAddTrace: () => void
}) {
  return (
    <div className="flex h-10 shrink-0 items-stretch border-b border-border/60">
      {/* 标签与添加入口：可横向滚动；右侧留白给窗口右上角固定开关（避免标签与其重叠） */}
      <div className="group/tabs flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto pr-12 pl-1.5">
        {tabs.map(tab => (
          <TabItem
            key={tab.id}
            tab={tab}
            active={tab.id === activeId}
            fileName={tab.kind === 'files' ? (fileViews[tab.id]?.file.name ?? null) : null}
            onSelect={onSelect}
            onClose={onClose}
          />
        ))}
        {/* 添加入口紧贴标签列表，仅在悬停标签行时展示 */}
        <div className="flex h-8 shrink-0 items-center gap-0.5">
          <DropdownMenu>
            <DropdownMenuTrigger render={(
              <button
                type="button"
                className="flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover/tabs:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100"
                aria-label="添加入口"
              >
                <PlusIcon className="size-3.5" />
              </button>
            )}
            />
            <DropdownMenuContent align="end" sideOffset={6}>
              <DropdownMenuItem onClick={onAddFiles}>
                <FolderTreeIcon className="size-3.5" />
                文件
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onAddTrace}>
                <ActivityIcon className="size-3.5" />
                Trace
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  )
}

function TabItem({ tab, active, fileName, onSelect, onClose }: {
  tab: SidebarTab
  active: boolean
  /** 文件管理标签当前打开的文件名（未打开文件时为 null） */
  fileName: string | null
  onSelect: (id: string) => void
  onClose: (id: string) => void
}) {
  const isFiles = tab.kind === 'files'
  // 文件管理标签：未选文件显示「文件」，选中文件后显示文件名
  const label = isFiles ? (fileName ?? '文件') : 'Trace'
  const selectLabel = isFiles
    ? (fileName ? `打开 ${fileName}` : '切换到文件管理')
    : '切换到执行轨迹'
  const closeLabel = isFiles
    ? (fileName ? `关闭 ${fileName}` : '关闭文件管理')
    : '关闭Trace'
  return (
    <div
      className={cn(
        'group flex h-8 max-w-44 min-w-0 shrink-0 items-center gap-1 rounded-t-md border border-b-0 px-2 text-xs',
        active
          ? 'border-border bg-background text-foreground'
          : 'border-transparent text-muted-foreground hover:bg-accent/50 hover:text-foreground',
      )}
      data-testid="sidebar-tab"
      data-kind={tab.kind}
      data-active={active}
    >
      {isFiles
        ? (fileName
            ? <FileTextIcon className="size-3.5 shrink-0 text-muted-foreground" />
            : <FolderTreeIcon className="size-3.5 shrink-0 text-muted-foreground" />)
        : <ActivityIcon className="size-3.5 shrink-0 text-muted-foreground" />}
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-1"
        onClick={() => onSelect(tab.id)}
        aria-label={selectLabel}
      >
        <span className="truncate">{label}</span>
      </button>
      <button
        type="button"
        className="flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100"
        onClick={() => onClose(tab.id)}
        aria-label={closeLabel}
      >
        <XIcon className="size-3" />
      </button>
    </div>
  )
}

function EmptyStateView({ onOpenFiles, onOpenTrace }: {
  onOpenFiles: () => void
  onOpenTrace: () => void
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-6">
      <p className="text-sm text-muted-foreground">选择要打开的辅助面板</p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs text-foreground/85 transition-colors hover:bg-accent hover:text-foreground"
          onClick={onOpenFiles}
        >
          <FolderTreeIcon className="size-3.5" />
          文件
        </button>
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs text-foreground/85 transition-colors hover:bg-accent hover:text-foreground"
          onClick={onOpenTrace}
        >
          <ActivityIcon className="size-3.5" />
          Trace
        </button>
      </div>
    </div>
  )
}

function useMediaQuery(query: string): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    const media = window.matchMedia(query)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [query])
  const snapshot = useCallback(() => window.matchMedia(query).matches, [query])
  return useSyncExternalStore(subscribe, snapshot, () => false)
}

function loadSavedWidth(): number {
  try {
    const raw = window.localStorage.getItem(WIDTH_STORAGE_KEY)
    const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
    return Number.isFinite(parsed) ? Math.max(MIN_PANEL_WIDTH, parsed) : DEFAULT_PANEL_WIDTH
  }
  catch {
    return DEFAULT_PANEL_WIDTH
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
