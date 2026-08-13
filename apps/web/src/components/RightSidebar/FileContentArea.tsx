import type { WorkspaceTextFileContent, WorkspaceTreeEntry } from '@ant-chat/shared'
import { CodeBlock } from '@workspace/ui/components/ai-elements/code-block'
import { Button } from '@workspace/ui/components/button'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { Spinner } from '@workspace/ui/components/spinner'
import { ChevronRightIcon, ExternalLinkIcon, FileTextIcon } from 'lucide-react'
import { Fragment } from 'react'
import { detectFileLanguage } from '../Workspace/fileLanguage'
import { detectFileKind, isMarkdownFileName } from './fileView'
import { MarkdownPreview } from './MarkdownPreview'
import { AudioPreview } from './previews/AudioPreview'
import { DocxPreview } from './previews/DocxPreview'
import { ExcelPreview } from './previews/ExcelPreview'
import { ImagePreview } from './previews/ImagePreview'
import { PdfPreview } from './previews/PdfPreview'
import { UnsupportedPreview } from './previews/UnsupportedPreview'
import { VideoPreview } from './previews/VideoPreview'

export type MarkdownMode = 'preview' | 'source'

/** 已打开文件的读取状态与查看模式（存于右侧栏标签状态中） */
export interface FileTabView {
  file: WorkspaceTreeEntry
  status: 'loading' | 'ready' | 'error'
  content?: WorkspaceTextFileContent
  /** 媒体文件（图片/音视频/Excel）的流式预览 URL */
  url?: string
  error?: string
  mode: MarkdownMode
}

interface FileHeaderProps {
  /** 当前文件；未打开文件时为 null（只展示工作区名与操作按钮） */
  file: WorkspaceTreeEntry | null
  view: FileTabView | null
  workspaceName: string
  onNavigateDir: (dirPath: string) => void
  onModeChange: (mode: MarkdownMode) => void
  /** 提供时在头部右侧展示「用默认软件打开当前文件」 */
  onOpenWithDefaultApp?: (file: WorkspaceTreeEntry) => void
  /** 头部右侧追加的操作（文件管理页签注入文件树开关） */
  headerExtra?: React.ReactNode
}

/**
 * 面包屑 + 内容操作头部行（文件管理页签与文件标签页共用）。
 * 右侧操作右对齐：Markdown 模式切换、用默认软件打开、外部注入（文件树开关）。
 */
export function FileHeader({
  file,
  view,
  workspaceName,
  onNavigateDir,
  onModeChange,
  onOpenWithDefaultApp,
  headerExtra,
}: FileHeaderProps) {
  return (
    <div className="flex h-8 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border/60 px-2 text-xs text-muted-foreground">
      {file
        ? <Breadcrumb file={file} workspaceName={workspaceName} onNavigateDir={onNavigateDir} />
        : <span className="shrink-0 rounded-sm px-1 py-0.5">{workspaceName}</span>}
      <div className="ml-auto flex shrink-0 items-center gap-1.5 pl-2">
        {file && view && isMarkdownFileName(file.name) && (
          <ModeToggle mode={view.mode} onChange={onModeChange} />
        )}
        {file && onOpenWithDefaultApp && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground"
            onClick={() => onOpenWithDefaultApp(file)}
            aria-label="用默认软件打开当前文件"
            title="用默认软件打开当前文件"
          >
            <ExternalLinkIcon className="size-4" />
          </Button>
        )}
        {headerExtra}
      </div>
    </div>
  )
}

interface FileContentAreaProps {
  file: WorkspaceTreeEntry
  view: FileTabView
  workspaceName: string
  onNavigateDir: (dirPath: string) => void
  onModeChange: (mode: MarkdownMode) => void
  /** 提供时在头部右侧展示「用默认软件打开当前文件」 */
  onOpenWithDefaultApp?: (file: WorkspaceTreeEntry) => void
  /** 头部已由外部（文件管理页签全宽头部）渲染时隐藏自身头部 */
  hideHeader?: boolean
}

/**
 * 文件内容区：面包屑头部 + 内容（文件管理页签与文件标签页共用）。
 * 面包屑并入头部，路径不再在内容中重复渲染。
 */
export function FileContentArea({
  file,
  view,
  workspaceName,
  onNavigateDir,
  onModeChange,
  onOpenWithDefaultApp,
  hideHeader = false,
}: FileContentAreaProps) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="file-content-area pl-1">
      {!hideHeader && (
        <FileHeader
          file={file}
          view={view}
          workspaceName={workspaceName}
          onNavigateDir={onNavigateDir}
          onModeChange={onModeChange}
          onOpenWithDefaultApp={onOpenWithDefaultApp}
        />
      )}
      <div className="min-h-0 flex-1 overflow-hidden pb-1">
        <ContentView file={file} view={view} />
      </div>
    </div>
  )
}

function ContentView({ file, view }: {
  file: WorkspaceTreeEntry
  view: FileTabView
}) {
  if (view.status === 'error') {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <p className="text-sm text-destructive" data-testid="file-preview-error">
          {view.error}
        </p>
      </div>
    )
  }
  if (view.status === 'loading') {
    return (
      <div className="flex h-full items-center justify-center" data-testid="file-preview-loading">
        <Spinner />
      </div>
    )
  }
  const kind = detectFileKind(file.name)

  // 二进制/超大文件（后端嗅探判定）：优先展示中性「暂不支持预览」占位（不做大小判断、不渲染为文本、非错误态）
  if (view.content?.binary) {
    return <UnsupportedPreview />
  }
  if (view.content?.oversize) {
    return (
      <UnsupportedPreview
        title="文件过大，暂不支持预览"
        description="文件超过 1MB，可用系统默认软件打开查看"
      />
    )
  }

  // 媒体类型：走流式（图片/音视频/Excel）预览
  if (kind === 'image' && view.url) {
    return <ImagePreview url={view.url} fileName={file.name} />
  }
  if (kind === 'audio' && view.url) {
    return <AudioPreview url={view.url} fileName={file.name} />
  }
  if (kind === 'video' && view.url) {
    return <VideoPreview url={view.url} fileName={file.name} />
  }
  if (kind === 'excel' && view.url) {
    return <ExcelPreview url={view.url} fileName={file.name} />
  }
  if (kind === 'pdf' && view.url) {
    return <PdfPreview url={view.url} fileName={file.name} />
  }
  if (kind === 'docx' && view.url) {
    return <DocxPreview url={view.url} fileName={file.name} />
  }

  // 文本类：需要 content
  const content = view.content!
  if (kind === 'markdown' && view.mode === 'preview') {
    return <MarkdownPreview content={content.content} />
  }
  return (
    <div className="h-full" data-testid="file-preview-content">
      <CodeBlock
        code={content.content}
        language={detectFileLanguage(file.name)}
        showLineNumbers
        className="h-full rounded-none border-0"
      />
    </div>
  )
}

function Breadcrumb({ file, workspaceName, onNavigateDir }: {
  file: WorkspaceTreeEntry
  workspaceName: string
  onNavigateDir: (dirPath: string) => void
}) {
  const segments = file.relPath.split('/')
  const dirSegments = segments.slice(0, -1)
  const fileName = segments.at(-1) ?? file.name
  return (
    <div className="flex min-w-0 items-center gap-0.5 select-none" data-testid="file-breadcrumb">
      {workspaceName}
      {dirSegments.map((segment, index) => {
        const dirPath = segments.slice(0, index + 1).join('/')
        return (
          <Fragment key={dirPath}>
            <ChevronRightIcon className="size-3 shrink-0" />
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="px-1 text-muted-foreground"
              onClick={() => onNavigateDir(dirPath)}
            >
              {segment}
            </Button>
          </Fragment>
        )
      })}
      <ChevronRightIcon className="size-3 shrink-0" />
      <span className="shrink-0 font-medium text-foreground">{fileName}</span>
    </div>
  )
}

function ModeToggle({ mode, onChange }: { mode: MarkdownMode, onChange: (mode: MarkdownMode) => void }) {
  // 单按钮切换：文案始终表达「点击后进入的模式」
  const isPreview = mode === 'preview'
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      className="text-muted-foreground"
      onClick={() => onChange(isPreview ? 'source' : 'preview')}
    >
      {isPreview ? '查看源代码' : '查看预览'}
    </Button>
  )
}

/** 无内容时的占位（文件管理页签未打开任何文件） */
export function NoFileSelectedState() {
  return (
    <div className="flex h-full items-center justify-center">
      <EmptyState
        icon={<FileTextIcon />}
        title="选择文件查看内容"
        description="点击文件树中的文件可打开"
      />
    </div>
  )
}
