import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { observabilityApi } from '@/api/observabilityApi'
import { useWorkspaceStore } from '@/store/workspace'
import { RightSidebar } from './RightSidebar'

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
    openWithDefaultApp: vi.fn(),
  },
}))

vi.mock('@/api/observabilityApi', () => ({
  observabilityApi: {
    listTurns: vi.fn(),
    getTurnTimeline: vi.fn(),
    getEvidence: vi.fn(),
  },
}))

vi.mock('@/api/transports/appEventSubscriptions', () => ({
  getAppEventSubscriptions: () => ({
    subscribe: () => () => {},
  }),
}))

vi.mock('@workspace/ui/components/ai-elements/code-block', () => ({
  CodeBlock: ({ code }: { code: string }) => <pre data-testid="mock-code-block">{code}</pre>,
}))

const WORKSPACE = '/tmp/ant-chat-workspace'

describe('rightSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useWorkspaceStore.setState({ currentWorkspacePath: '' })
    vi.mocked(observabilityApi.listTurns).mockResolvedValue([])
    window.matchMedia = vi.fn().mockImplementation(query => ({
      addEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      matches: false,
      media: query,
      onchange: null,
      removeEventListener: vi.fn(),
    }))
  })

  it('关闭时宽屏侧栏隐藏但保持挂载，展开后可见', () => {
    const { rerender } = render(<RightSidebar open={false} onClose={() => {}} />)
    // 常驻渲染：收起态从可访问性树中隐藏（宽度 0 + invisible）
    expect(screen.queryByRole('complementary', { name: '右侧辅助栏' })).not.toBeInTheDocument()

    rerender(<RightSidebar open onClose={() => {}} />)

    expect(screen.getByRole('complementary', { name: '右侧辅助栏' })).toBeInTheDocument()
  })

  it('默认空态：居中展示 文件 / Trace 两个入口', () => {
    render(<RightSidebar open onClose={() => {}} />)

    expect(screen.getByRole('button', { name: '文件' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Trace' })).toBeInTheDocument()
    expect(screen.queryByTestId('sidebar-tab')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加入口' })).toBeInTheDocument()
    // 侧栏开关唯一且固定在窗口右上角，由父组件 Chat 渲染，侧栏内部不重复提供收起按钮
    expect(screen.queryByRole('button', { name: '收起右侧栏' })).not.toBeInTheDocument()
  })

  it('点击文件入口打开文件管理标签并展示文件面板', async () => {
    useWorkspaceStore.setState({ currentWorkspacePath: WORKSPACE })
    listDirectoryEntries.mockResolvedValue({ dirs: [], files: [{ name: 'a.txt', relPath: 'a.txt', type: 'file' }] })
    render(<RightSidebar open onClose={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: '文件' }))

    expect(await screen.findByTestId('files-panel')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar-tab')).toHaveAttribute('data-kind', 'files')
    expect(listDirectoryEntries).toHaveBeenCalledWith(WORKSPACE, undefined)
  })

  it('从文件树打开文件后文件管理标签显示文件名，重复点击不新增标签', async () => {
    useWorkspaceStore.setState({ currentWorkspacePath: WORKSPACE })
    listDirectoryEntries.mockResolvedValue({ dirs: [], files: [{ name: 'a.txt', relPath: 'a.txt', type: 'file' }] })
    readTextFile.mockResolvedValue({ content: 'hello', size: 5 })
    render(<RightSidebar open onClose={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: '文件' }))
    fireEvent.click(await screen.findByRole('button', { name: 'a.txt' }))

    await waitFor(() => expect(readTextFile).toHaveBeenCalledWith(WORKSPACE, 'a.txt'))
    // 不新增标签：文件管理标签直接显示文件名
    expect(screen.getAllByTestId('sidebar-tab')).toHaveLength(1)
    expect(screen.getByTestId('sidebar-tab')).toHaveAttribute('data-kind', 'files')
    expect(screen.getByTestId('sidebar-tab').textContent).toContain('a.txt')
    expect(screen.getByRole('button', { name: '打开 a.txt' })).toBeInTheDocument()
    // 内容镜像展示；文件树开关与「用默认软件打开」仍在头部（打开文件不隐藏文件树）
    expect(screen.getAllByTestId('mock-code-block').some(el => el.textContent?.includes('hello'))).toBe(true)
    expect(screen.getByRole('button', { name: '隐藏文件树' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '用默认软件打开当前文件' })).toBeInTheDocument()

    // 再次点击同一文件 → 不新增标签
    fireEvent.click(screen.getByRole('button', { name: 'a.txt' }))
    await waitFor(() => expect(screen.getAllByTestId('sidebar-tab')).toHaveLength(1))
  })

  it('已打开文件后再点击 + 文件 新建文件管理标签而不是跳转', async () => {
    useWorkspaceStore.setState({ currentWorkspacePath: WORKSPACE })
    listDirectoryEntries.mockResolvedValue({ dirs: [], files: [{ name: 'a.txt', relPath: 'a.txt', type: 'file' }] })
    readTextFile.mockResolvedValue({ content: 'hello', size: 5 })
    render(<RightSidebar open onClose={() => {}} />)

    // 打开第一个文件管理标签并选中文件 → 标签显示文件名
    fireEvent.click(screen.getByRole('button', { name: '文件' }))
    fireEvent.click(await screen.findByRole('button', { name: 'a.txt' }))
    await waitFor(() => expect(screen.getAllByTestId('sidebar-tab')).toHaveLength(1))
    expect(screen.getAllByTestId('sidebar-tab')[0].textContent).toContain('a.txt')

    // 再点 + → 文件 → 新建第二个文件管理标签（空态显示「文件」）并激活，而不是跳转
    fireEvent.click(screen.getByRole('button', { name: '添加入口' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '文件' }))
    await waitFor(() => expect(screen.getAllByTestId('sidebar-tab')).toHaveLength(2))
    const newTab = screen.getAllByTestId('sidebar-tab')[1]
    expect(newTab).toHaveAttribute('data-kind', 'files')
    expect(newTab).toHaveAttribute('data-active', 'true')
    expect(newTab.textContent).toContain('文件')
    expect(screen.getByText('选择文件查看内容')).toBeInTheDocument()
  })

  it('点击 Trace 入口打开执行轨迹，且 Trace 标签唯一', async () => {
    render(<RightSidebar open conversationId="conversation-1" onClose={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: 'Trace' }))

    expect(await screen.findByText('执行轨迹')).toBeInTheDocument()
    expect(observabilityApi.listTurns).toHaveBeenCalledWith('conversation-1')
    expect(screen.getAllByTestId('sidebar-tab')).toHaveLength(1)

    // 通过 + 菜单再次添加 Trace → 不新增
    fireEvent.click(screen.getByRole('button', { name: '添加入口' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Trace' }))
    await waitFor(() => expect(screen.getAllByTestId('sidebar-tab')).toHaveLength(1))
  })

  it('+ 菜单可以添加文件管理入口', async () => {
    render(<RightSidebar open onClose={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: '添加入口' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '文件' }))

    await waitFor(() => expect(screen.getByTestId('sidebar-tab')).toHaveAttribute('data-kind', 'files'))
  })

  it('关闭激活标签后回到空态', async () => {
    render(<RightSidebar open onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Trace' }))
    await screen.findByText('执行轨迹')

    fireEvent.click(screen.getByRole('button', { name: '关闭Trace' }))

    await waitFor(() => expect(screen.getByRole('button', { name: '文件' })).toBeInTheDocument())
    expect(screen.queryByTestId('sidebar-tab')).not.toBeInTheDocument()
  })

  it('从消息跳转 Trace 时自动打开 Trace 标签', async () => {
    render(<RightSidebar open focusTurnId="turn-1" conversationId="conversation-1" onClose={() => {}} />)

    expect(await screen.findByText('执行轨迹')).toBeInTheDocument()
    expect(observabilityApi.listTurns).toHaveBeenCalledWith('conversation-1')
  })

  it('窄屏退化为全屏 Sheet 抽屉', async () => {
    window.matchMedia = vi.fn().mockImplementation(query => ({
      addEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      matches: true,
      media: query,
      onchange: null,
      removeEventListener: vi.fn(),
    }))

    render(<RightSidebar open onClose={() => {}} />)

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: '右侧辅助栏' })).not.toBeInTheDocument()
  })
})
