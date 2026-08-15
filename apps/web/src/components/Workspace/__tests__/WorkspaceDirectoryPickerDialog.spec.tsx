import type { WorkspaceDirectoryListing } from '@ant-chat/shared'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceDirectoryPickerDialog } from '../WorkspaceDirectoryPickerDialog'

const rootListing: WorkspaceDirectoryListing = {
  currentPath: '/',
  parentPath: null,
  roots: [{ path: '/', label: '/' }],
  breadcrumbs: [{ name: '/', path: '/' }],
  directories: [
    { name: 'src', path: '/src' },
    { name: 'docs', path: '/docs' },
  ],
}

const srcListing: WorkspaceDirectoryListing = {
  currentPath: '/src',
  parentPath: '/',
  roots: [{ path: '/', label: '/' }],
  breadcrumbs: [
    { name: '/', path: '/' },
    { name: 'src', path: '/src' },
  ],
  directories: [{ name: 'assets', path: '/src/assets' }],
}

/** Windows 下的 listing：currentPath 使用反斜杠，breadcrumbs/roots 由后端按平台生成 */
const windowsListing: WorkspaceDirectoryListing = {
  currentPath: 'C:\\Users\\me',
  parentPath: 'C:\\Users',
  roots: [
    { path: 'C:\\', label: 'C:' },
    { path: 'D:\\', label: 'D:' },
  ],
  breadcrumbs: [
    { name: 'C:', path: 'C:\\' },
    { name: 'Users', path: 'C:\\Users' },
    { name: 'me', path: 'C:\\Users\\me' },
  ],
  directories: [{ name: 'projects', path: 'C:\\Users\\me\\projects' }],
}

const { listDirectories } = vi.hoisted(() => ({ listDirectories: vi.fn() }))

vi.mock('@/api/workspaceApi', () => ({
  default: {
    listDirectories,
  },
}))

function renderDialog(onConfirm = vi.fn<(path: string) => void>()) {
  return {
    onConfirm,
    ...render(
      <WorkspaceDirectoryPickerDialog
        open
        onOpenChange={() => {}}
        onConfirm={onConfirm}
      />,
    ),
  }
}

/** 渲染对话框并等待搜索框出现（及可选目录按钮渲染完成） */
async function openRootDialog(waitForButton = 'src') {
  renderDialog()
  const filterInput = await screen.findByPlaceholderText('搜索目录...')
  if (waitForButton) {
    await waitFor(() => expect(screen.getByRole('button', { name: waitForButton })).toBeInTheDocument())
  }
  return filterInput
}

describe('workspaceDirectoryPickerDialog 键盘导航', () => {
  beforeEach(() => {
    // reset 同时清空 mockResolvedValueOnce 队列，避免用例间残留污染
    vi.resetAllMocks()
  })

  it('上下方向键移动选中，回车添加当前目录作为工作区', async () => {
    listDirectories.mockResolvedValue(rootListing)
    const { onConfirm } = renderDialog()

    const filterInput = await screen.findByPlaceholderText('搜索目录...')
    await waitFor(() => expect(screen.getByRole('button', { name: 'src' })).toBeInTheDocument())
    const srcButton = screen.getByRole('button', { name: 'src' })
    const docsButton = screen.getByRole('button', { name: 'docs' })

    // 无高亮时按 ↓ 落到第一项
    fireEvent.keyDown(filterInput, { key: 'ArrowDown' })
    expect(srcButton).toHaveClass('bg-accent')
    expect(srcButton).toHaveAttribute('data-highlighted', 'true')

    // ↓ 移动到第二项
    fireEvent.keyDown(filterInput, { key: 'ArrowDown' })
    expect(docsButton).toHaveClass('bg-accent')
    expect(srcButton).not.toHaveAttribute('data-highlighted', 'true')

    // 回车 = 添加当前高亮目录
    fireEvent.keyDown(filterInput, { key: 'Enter' })
    expect(onConfirm).toHaveBeenCalledWith('/docs')
  })

  it('右键进入子目录，切换后焦点回到输入框、键盘导航不失效', async () => {
    listDirectories
      .mockResolvedValueOnce(rootListing)
      .mockResolvedValueOnce(srcListing)

    const filterInput = await openRootDialog()

    // 高亮第一项后按 → 进入子目录
    fireEvent.keyDown(filterInput, { key: 'ArrowDown' })
    fireEvent.keyDown(filterInput, { key: 'ArrowRight' })
    await waitFor(() => expect(listDirectories).toHaveBeenLastCalledWith('/src'))

    // 切换目录后焦点归还 filter input，继续按键仍然有效
    await waitFor(() => expect(filterInput).toHaveFocus())
    const assetsButton = await screen.findByRole('button', { name: 'assets' })
    fireEvent.keyDown(filterInput, { key: 'ArrowDown' })
    expect(assetsButton).toHaveAttribute('data-highlighted', 'true')
  })

  it('焦点不在搜索框（例如被重置到 body）时键盘导航仍然有效', async () => {
    listDirectories.mockResolvedValue(rootListing)

    await openRootDialog()
    await waitFor(() => expect(screen.getByRole('button', { name: 'src' })).toBeInTheDocument())

    // 焦点不在 filter input 上（切目录时可能短暂丢失焦点）
    document.body.focus()
    fireEvent.keyDown(document.body, { key: 'ArrowDown' })

    expect(screen.getByRole('button', { name: 'src' })).toHaveAttribute('data-highlighted', 'true')
  })

  it('左键返回上级目录', async () => {
    listDirectories
      .mockResolvedValueOnce(rootListing)
      .mockResolvedValueOnce(srcListing)

    const filterInput = await openRootDialog()

    fireEvent.keyDown(filterInput, { key: 'ArrowDown' })
    fireEvent.keyDown(filterInput, { key: 'ArrowRight' })
    await waitFor(() => expect(listDirectories).toHaveBeenLastCalledWith('/src'))
    // 等待子目录加载完成（listing 切换到 /src 后 parentPath 才有效）
    await waitFor(() => expect(screen.getByRole('button', { name: 'assets' })).toBeInTheDocument())

    fireEvent.keyDown(filterInput, { key: 'ArrowLeft' })
    await waitFor(() => expect(listDirectories).toHaveBeenLastCalledWith('/'))
  })

  it('搜索框有文字时 ←/→ 移动光标而不是导航目录', async () => {
    listDirectories.mockResolvedValue(rootListing)

    const filterInput = await openRootDialog()

    fireEvent.change(filterInput, { target: { value: 'src' } })
    fireEvent.keyDown(filterInput, { key: 'ArrowRight' })
    fireEvent.keyDown(filterInput, { key: 'ArrowLeft' })

    // 只有 mount 时的一次加载，←/→ 未触发任何目录跳转
    expect(listDirectories).toHaveBeenCalledTimes(1)
  })

  it('tab 等价右键：进入当前高亮目录', async () => {
    listDirectories
      .mockResolvedValueOnce(rootListing)
      .mockResolvedValueOnce(srcListing)

    const filterInput = await openRootDialog()

    fireEvent.keyDown(filterInput, { key: 'ArrowDown' })
    fireEvent.keyDown(filterInput, { key: 'Tab' })
    await waitFor(() => expect(listDirectories).toHaveBeenLastCalledWith('/src'))
  })

  it('空列表时 →/Tab 不触发目录跳转', async () => {
    listDirectories
      .mockResolvedValueOnce({ ...rootListing, directories: [] })

    const filterInput = await openRootDialog('')
    await waitFor(() => expect(screen.getByText('暂无目录')).toBeInTheDocument())

    fireEvent.keyDown(filterInput, { key: 'ArrowRight' })
    fireEvent.keyDown(filterInput, { key: 'Tab' })

    expect(listDirectories).toHaveBeenCalledTimes(1)
  })

  it('新建文件夹输入框聚焦时回车不被劫持为添加工作区', async () => {
    listDirectories.mockResolvedValue(rootListing)
    const { onConfirm } = renderDialog()

    await screen.findByPlaceholderText('搜索目录...')
    await waitFor(() => expect(screen.getByRole('button', { name: 'src' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '新建文件夹' }))

    const newFolderInput = await screen.findByPlaceholderText('文件夹名称')
    fireEvent.keyDown(newFolderInput, { key: 'Enter' })

    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('win32 下按后端提供的面包屑逐级导航，不自行按 / 解析路径', async () => {
    listDirectories
      .mockResolvedValueOnce(windowsListing)
      .mockResolvedValueOnce(windowsListing)

    renderDialog()
    await screen.findByPlaceholderText('搜索目录...')
    await waitFor(() => expect(screen.getByRole('button', { name: 'projects' })).toBeInTheDocument())

    // 面包屑展示 C: / Users / me，而不是把整个反斜杠路径当一段；
    // 盘符下拉已合并进面包屑首段，C: 只出现一次
    expect(screen.getByRole('button', { name: 'C:' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Users' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'me' })).toBeInTheDocument()

    // 点击 Users 直接跳转到后端给出的绝对路径
    fireEvent.click(screen.getByRole('button', { name: 'Users' }))
    await waitFor(() => expect(listDirectories).toHaveBeenLastCalledWith('C:\\Users'))
  })

  it('win32 下通过合并进面包屑的盘符下拉切换到对应驱动器', async () => {
    listDirectories.mockResolvedValue(windowsListing)

    renderDialog()
    await screen.findByPlaceholderText('搜索目录...')
    await waitFor(() => expect(screen.getByRole('button', { name: 'projects' })).toBeInTheDocument())

    // 点击面包屑首段 C: 打开盘符下拉并选择 D:
    fireEvent.click(screen.getByRole('button', { name: 'C:' }))
    const dMenuItem = await screen.findByRole('menuitem', { name: 'D:' })
    fireEvent.click(dMenuItem)
    await waitFor(() => expect(listDirectories).toHaveBeenLastCalledWith('D:\\'))
  })
})
