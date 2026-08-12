import type { WorkspaceDirectoryEntries } from '@ant-chat/shared'
import type { FilesPanelProps } from './FilesPanel'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkspaceStore } from '@/store/workspace'
import { FilesPanel } from './FilesPanel'

const { listDirectoryEntries, readTextFile, searchWorkspaceFiles } = vi.hoisted(() => ({
  listDirectoryEntries: vi.fn(),
  readTextFile: vi.fn(),
  searchWorkspaceFiles: vi.fn(),
}))

vi.mock('@/api/workspaceApi', () => ({
  default: {
    listDirectoryEntries,
    readTextFile,
    searchWorkspaceFiles,
  },
}))

vi.mock('@workspace/ui/components/ai-elements/code-block', () => ({
  CodeBlock: ({ code }: { code: string }) => <pre data-testid="mock-code-block">{code}</pre>,
}))

const WORKSPACE = '/tmp/ant-chat-workspace'

const rootListing: WorkspaceDirectoryEntries = {
  dirs: [{ name: 'src', relPath: 'src', type: 'directory' }],
  files: [
    { name: 'README.md', relPath: 'README.md', type: 'file' },
    { name: 'hello.txt', relPath: 'hello.txt', type: 'file' },
  ],
}

const srcListing: WorkspaceDirectoryEntries = {
  dirs: [],
  files: [{ name: 'index.ts', relPath: 'src/index.ts', type: 'file' }],
}

function defaultProps(): FilesPanelProps {
  return {
    activeFile: null,
    activeFileView: null,
    revealPath: null,
    onModeChange: vi.fn(),
    onOpenFile: vi.fn(),
    onRevealDir: vi.fn(),
    onOpenWithDefaultApp: vi.fn(),
  }
}

describe('filesPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useWorkspaceStore.setState({ currentWorkspacePath: WORKSPACE })
  })

  it('未选择工作区时展示引导空态', () => {
    useWorkspaceStore.setState({ currentWorkspacePath: '' })
    render(<FilesPanel {...defaultProps()} />)
    expect(screen.getByText('未选择工作区')).toBeInTheDocument()
    expect(listDirectoryEntries).not.toHaveBeenCalled()
  })

  it('渲染根目录并在展开目录时懒加载子条目', async () => {
    listDirectoryEntries.mockImplementation(async (_ws: string, relPath?: string) =>
      relPath === 'src' ? srcListing : rootListing,
    )
    render(<FilesPanel {...defaultProps()} />)

    await waitFor(() => expect(screen.getByRole('button', { name: 'README.md' })).toBeInTheDocument())
    const srcButton = screen.getByRole('button', { name: 'src' })
    expect(srcButton).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(srcButton)

    await waitFor(() => expect(screen.getByRole('button', { name: 'index.ts' })).toBeInTheDocument())
    expect(listDirectoryEntries).toHaveBeenCalledWith(WORKSPACE, undefined)
    expect(listDirectoryEntries).toHaveBeenCalledWith(WORKSPACE, 'src')
    expect(screen.getByRole('button', { name: 'src' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('点击文件时回调打开文件', async () => {
    listDirectoryEntries.mockResolvedValue(rootListing)
    const onOpenFile = vi.fn()
    render(<FilesPanel {...defaultProps()} onOpenFile={onOpenFile} />)

    fireEvent.click(await screen.findByRole('button', { name: 'hello.txt' }))

    expect(onOpenFile).toHaveBeenCalledWith({ name: 'hello.txt', relPath: 'hello.txt', type: 'file' })
  })

  it('未打开文件时展示选择引导，打开后镜像内容区', async () => {
    listDirectoryEntries.mockResolvedValue(rootListing)
    readTextFile.mockResolvedValue({ content: '# 标题', size: 9 })
    const props = defaultProps()
    const { rerender } = render(<FilesPanel {...props} />)
    expect(screen.getByText('选择文件查看内容')).toBeInTheDocument()

    rerender(
      <FilesPanel
        {...props}
        activeFile={{ name: 'README.md', relPath: 'README.md', type: 'file' }}
        activeFileView={{ file: { name: 'README.md', relPath: 'README.md', type: 'file' }, status: 'ready', content: { content: '# 标题', size: 9 }, mode: 'preview' }}
      />,
    )
    expect(await screen.findByRole('heading', { name: '标题' })).toBeInTheDocument()
    expect(screen.getByTestId('file-breadcrumb').textContent).toContain('ant-chat-workspace')
  })

  it('文件名过滤走后端搜索并可从结果打开文件', async () => {
    listDirectoryEntries.mockImplementation(async (_ws: string, relPath?: string) =>
      relPath === 'src' ? srcListing : rootListing,
    )
    searchWorkspaceFiles.mockResolvedValue([{ path: 'src/index.ts', name: 'index.ts', type: 'file' }])
    const onOpenFile = vi.fn()
    const onRevealDir = vi.fn()
    render(<FilesPanel {...defaultProps()} onOpenFile={onOpenFile} onRevealDir={onRevealDir} />)

    fireEvent.change(screen.getByRole('textbox', { name: '过滤文件名' }), { target: { value: 'index' } })

    expect(await screen.findByTestId('file-search-results')).toBeInTheDocument()
    expect(searchWorkspaceFiles).toHaveBeenCalledWith(WORKSPACE, 'index', 50)

    fireEvent.click(screen.getByRole('button', { name: /index\.ts/ }))

    expect(onOpenFile).toHaveBeenCalledWith({ name: 'index.ts', relPath: 'src/index.ts', type: 'file' })
    expect(onRevealDir).toHaveBeenCalledWith('src')
    await waitFor(() => expect(screen.getByRole('textbox', { name: '过滤文件名' })).toHaveValue(''))
  })

  it('搜索结果为空时给出提示', async () => {
    listDirectoryEntries.mockResolvedValue(rootListing)
    searchWorkspaceFiles.mockResolvedValue([])
    render(<FilesPanel {...defaultProps()} />)

    fireEvent.change(screen.getByRole('textbox', { name: '过滤文件名' }), { target: { value: 'nope' } })

    expect(await screen.findByText('没有匹配的文件')).toBeInTheDocument()
  })

  it('文件树可整体隐藏与恢复', async () => {
    listDirectoryEntries.mockResolvedValue(rootListing)
    render(<FilesPanel {...defaultProps()} />)
    await screen.findByRole('button', { name: 'README.md' })

    fireEvent.click(screen.getByRole('button', { name: '隐藏文件树' }))
    expect(screen.queryByRole('button', { name: 'README.md' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '显示文件树' }))
    expect(await screen.findByRole('button', { name: 'README.md' })).toBeInTheDocument()
  })

  it('打开按钮：有激活文件时用默认软件打开，未打开文件时不展示', async () => {
    listDirectoryEntries.mockResolvedValue(rootListing)
    const onOpenWithDefaultApp = vi.fn()
    const props = defaultProps()
    const { rerender } = render(<FilesPanel {...props} onOpenWithDefaultApp={onOpenWithDefaultApp} />)

    expect(screen.queryByRole('button', { name: '用默认软件打开当前文件' })).not.toBeInTheDocument()

    rerender(
      <FilesPanel
        {...props}
        onOpenWithDefaultApp={onOpenWithDefaultApp}
        activeFile={{ name: 'hello.txt', relPath: 'hello.txt', type: 'file' }}
        activeFileView={{ file: { name: 'hello.txt', relPath: 'hello.txt', type: 'file' }, status: 'ready', content: { content: 'x', size: 1 }, mode: 'source' }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '用默认软件打开当前文件' }))
    expect(onOpenWithDefaultApp).toHaveBeenCalledWith({ name: 'hello.txt', relPath: 'hello.txt', type: 'file' })
  })

  it('面包屑目录点击回调定位展开', async () => {
    listDirectoryEntries.mockImplementation(async (_ws: string, relPath?: string) =>
      relPath === 'src' ? srcListing : rootListing,
    )
    readTextFile.mockResolvedValue({ content: 'const x = 1', size: 10 })
    const onRevealDir = vi.fn()
    render(
      <FilesPanel
        {...defaultProps()}
        onRevealDir={onRevealDir}
        activeFile={{ name: 'index.ts', relPath: 'src/index.ts', type: 'file' }}
        activeFileView={{ file: { name: 'index.ts', relPath: 'src/index.ts', type: 'file' }, status: 'ready', content: { content: 'const x = 1', size: 10 }, mode: 'source' }}
      />,
    )

    fireEvent.click(within(screen.getByTestId('file-breadcrumb')).getByRole('button', { name: 'src' }))

    expect(onRevealDir).toHaveBeenCalledWith('src')
  })

  it('根目录读取失败时展示错误而不是白屏', async () => {
    listDirectoryEntries.mockRejectedValue(new Error('工作区不可用'))
    render(<FilesPanel {...defaultProps()} />)

    await waitFor(() => expect(screen.getByText('工作区不可用')).toBeInTheDocument())
  })
})
