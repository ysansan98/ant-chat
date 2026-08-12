import type { SkillIndex, SkillManifest } from '@ant-chat/shared'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { skillApi } from '@/api/skillApi'
import SkillManage from './SkillManage'

vi.mock('@/api/skillApi', () => ({
  skillApi: {
    listSkills: vi.fn(),
    rebuildSkillIndex: vi.fn(),
    importSkill: vi.fn(),
    previewGithubSkills: vi.fn(),
    importGithubSkills: vi.fn(),
    setSkillEnabled: vi.fn(),
    deleteSkill: vi.fn(),
  },
}))

function skill(name: string, overrides: Partial<SkillManifest> = {}): SkillManifest {
  return {
    name,
    description: `${name} 的描述`,
    enabled: true,
    builtin: false,
    source: 'github',
    installedAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

function skillIndex(skills: SkillManifest[]): SkillIndex {
  return { rootPath: '/tmp/skills', skills }
}

async function openGithubImport() {
  fireEvent.click(await screen.findByRole('button', { name: '导入 Skill' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: 'GitHub 仓库' }))
  await screen.findByPlaceholderText(/github\.com/)
}

async function openZipImport() {
  fireEvent.click(await screen.findByRole('button', { name: '导入 Skill' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: 'ZIP 文件' }))
  await screen.findByLabelText('点击选择或拖拽 ZIP 文件')
}

describe('skillManage 删除二次确认', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(skillApi.listSkills).mockResolvedValue(
      skillIndex([skill('demo-skill'), skill('builtin-skill', { builtin: true })]),
    )
  })

  it('点击删除按钮先弹出确认 Popover，不会直接调用删除接口', async () => {
    render(<SkillManage />)

    fireEvent.click(await screen.findByRole('button', { name: '删除 demo-skill' }))

    expect(await screen.findByText('确认删除「demo-skill」？此操作不可撤销。')).toBeInTheDocument()
    expect(skillApi.deleteSkill).not.toHaveBeenCalled()
  })

  it('点击「取消」关闭弹层且不删除', async () => {
    render(<SkillManage />)

    fireEvent.click(await screen.findByRole('button', { name: '删除 demo-skill' }))
    fireEvent.click(await screen.findByRole('button', { name: '取消' }))

    await waitFor(() => expect(screen.queryByText(/确认删除「demo-skill」/)).not.toBeInTheDocument())
    expect(skillApi.deleteSkill).not.toHaveBeenCalled()
  })

  it('「导入 Skill」按钮展开菜单，包含 ZIP 文件与 GitHub 仓库两个入口', async () => {
    render(<SkillManage />)

    fireEvent.click(await screen.findByRole('button', { name: '导入 Skill' }))

    expect(await screen.findByRole('menuitem', { name: 'ZIP 文件' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'GitHub 仓库' })).toBeInTheDocument()
  })

  it('gitHub 导入：预览仓库后勾选并批量导入选中项', async () => {
    vi.mocked(skillApi.previewGithubSkills).mockResolvedValue([
      { path: 'skills/engineering/code-review', name: 'code-review', category: 'engineering', description: 'Review code.' },
      { path: 'skills/productivity/todo', name: 'todo', category: 'productivity', description: 'Track todos.' },
    ])
    vi.mocked(skillApi.importGithubSkills).mockResolvedValue({
      installed: [skill('code-review')],
      skipped: [],
    })
    render(<SkillManage />)

    await openGithubImport()
    fireEvent.change(
      screen.getByPlaceholderText(/github\.com/),
      { target: { value: 'https://github.com/acme/writer' } },
    )
    fireEvent.click(screen.getByRole('button', { name: '预览' }))

    expect(await screen.findByText('code-review')).toBeInTheDocument()
    expect(screen.getByText('todo')).toBeInTheDocument()
    expect(screen.getByText('engineering')).toBeInTheDocument()

    // 默认全选，取消 todo
    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes).toHaveLength(2)
    expect(checkboxes[0]).toBeChecked()
    expect(checkboxes[1]).toBeChecked()
    fireEvent.click(checkboxes[1])

    fireEvent.click(screen.getByRole('button', { name: '导入选中（1）' }))

    await waitFor(() => expect(skillApi.importGithubSkills).toHaveBeenCalledWith(
      'https://github.com/acme/writer',
      ['skills/engineering/code-review'],
    ))
    await waitFor(() => expect(screen.queryByPlaceholderText(/github\.com/)).not.toBeInTheDocument())
  })

  it('gitHub 预览无结果时提示且导入按钮禁用', async () => {
    vi.mocked(skillApi.previewGithubSkills).mockResolvedValue([])
    render(<SkillManage />)

    await openGithubImport()
    fireEvent.change(
      screen.getByPlaceholderText(/github\.com/),
      { target: { value: 'https://github.com/acme/writer' } },
    )
    fireEvent.click(screen.getByRole('button', { name: '预览' }))

    expect(await screen.findByText(/未在仓库根或 skills\/ 目录发现/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '导入' })).toBeDisabled()
  })

  it('gitHub 预览：分类头可折叠展开，支持分类级全选/清空', async () => {
    vi.mocked(skillApi.previewGithubSkills).mockResolvedValue([
      { path: 'skills/engineering/code-review', name: 'code-review', category: 'engineering', description: 'Review code.' },
      { path: 'skills/engineering/tdd', name: 'tdd', category: 'engineering', description: 'TDD.' },
      { path: 'skills/productivity/todo', name: 'todo', category: 'productivity', description: 'Track todos.' },
    ])
    render(<SkillManage />)

    await openGithubImport()
    fireEvent.change(
      screen.getByPlaceholderText(/github\.com/),
      { target: { value: 'https://github.com/acme/writer' } },
    )
    fireEvent.click(screen.getByRole('button', { name: '预览' }))

    const engineeringHeader = await screen.findByRole('button', { name: /engineering\s*2\/2/ })
    const gridOf = (text: string) => screen.getByText(text).closest('label')!.parentElement!.parentElement!

    // 折叠 engineering：组内 skill 折叠为 0fr 隐藏，其他分类不受影响
    fireEvent.click(engineeringHeader)
    expect(gridOf('code-review')).toHaveStyle({ gridTemplateRows: '0fr' })
    expect(gridOf('todo')).toHaveStyle({ gridTemplateRows: '1fr' })

    // 展开恢复
    fireEvent.click(screen.getByRole('button', { name: /engineering\s*2\/2/ }))
    expect(gridOf('code-review')).toHaveStyle({ gridTemplateRows: '1fr' })

    // 分类级清空：全局 + engineering + productivity 各一个「清空」按钮
    const clearButtons = screen.getAllByRole('button', { name: '清空' })
    expect(clearButtons).toHaveLength(3)
    fireEvent.click(clearButtons[2])
    expect(screen.getByRole('checkbox', { name: /todo/ })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: /code-review/ })).toBeChecked()

    // 分类级全选恢复 productivity 组
    fireEvent.click(screen.getAllByRole('button', { name: '全选' })[1])
    expect(screen.getByRole('checkbox', { name: /todo/ })).toBeChecked()
  })

  it('gitHub 预览：过滤框按名称或描述筛选列表', async () => {
    vi.mocked(skillApi.previewGithubSkills).mockResolvedValue([
      { path: 'skills/engineering/code-review', name: 'code-review', category: 'engineering', description: 'Review code.' },
      { path: 'skills/productivity/todo', name: 'todo', category: 'productivity', description: 'Track todos.' },
    ])
    render(<SkillManage />)

    await openGithubImport()
    fireEvent.change(
      screen.getByPlaceholderText(/github\.com/),
      { target: { value: 'https://github.com/acme/writer' } },
    )
    fireEvent.click(screen.getByRole('button', { name: '预览' }))

    const filterInput = await screen.findByPlaceholderText('按名称或描述过滤')
    fireEvent.change(filterInput, { target: { value: 'review' } })

    expect(screen.getByText('code-review')).toBeInTheDocument()
    expect(screen.queryByText('todo')).not.toBeInTheDocument()

    // 按描述过滤：'Track todos.' 命中
    fireEvent.change(filterInput, { target: { value: 'todos' } })

    expect(screen.getByText('todo')).toBeInTheDocument()
    expect(screen.queryByText('code-review')).not.toBeInTheDocument()
  })

  it('gitHub 弹窗关闭后清空预览状态，重新打开需重新预览', async () => {
    vi.mocked(skillApi.previewGithubSkills).mockResolvedValue([
      { path: 'skills/engineering/code-review', name: 'code-review', category: 'engineering', description: 'Review code.' },
    ])
    render(<SkillManage />)

    await openGithubImport()
    fireEvent.change(
      screen.getByPlaceholderText(/github\.com/),
      { target: { value: 'https://github.com/acme/writer' } },
    )
    fireEvent.click(screen.getByRole('button', { name: '预览' }))
    expect(await screen.findByText('code-review')).toBeInTheDocument()

    // 取消关闭弹窗
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByPlaceholderText(/github\.com/)).not.toBeInTheDocument())

    // 重新打开：URL 与预览状态均已清空
    await openGithubImport()
    expect(screen.getByPlaceholderText(/github\.com/)).toHaveValue('')
    expect(screen.queryByText('code-review')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '预览' })).toBeDisabled()
  })

  it('zIP 导入：选择 .zip 文件后点「导入」调用接口并关闭弹窗', async () => {
    const file = new File(['zip-bytes'], 'demo-skill.zip', { type: 'application/zip' })
    vi.mocked(skillApi.importSkill).mockResolvedValue(skill('zip-skill'))
    render(<SkillManage />)

    await openZipImport()
    fireEvent.change(
      screen.getByLabelText('点击选择或拖拽 ZIP 文件'),
      { target: { files: [file] } },
    )

    expect(screen.getByText('demo-skill.zip')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '导入' }))

    await waitFor(() => expect(skillApi.importSkill).toHaveBeenCalledWith({
      source: 'zip',
      zipBase64: btoa('zip-bytes'),
    }))
    await waitFor(() => expect(screen.queryByLabelText('点击选择或拖拽 ZIP 文件')).not.toBeInTheDocument())
  })

  it('zIP 导入：选择非 .zip 文件被拒绝且不触发导入', async () => {
    render(<SkillManage />)

    await openZipImport()
    fireEvent.change(
      screen.getByLabelText('点击选择或拖拽 ZIP 文件'),
      { target: { files: [new File(['x'], 'note.txt', { type: 'text/plain' })] } },
    )

    expect(screen.queryByText('note.txt')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '导入' })).toBeDisabled()
    expect(skillApi.importSkill).not.toHaveBeenCalled()
  })

  it('zIP 导入：移除已选文件后「导入」按钮回到禁用', async () => {
    render(<SkillManage />)

    await openZipImport()
    fireEvent.change(
      screen.getByLabelText('点击选择或拖拽 ZIP 文件'),
      { target: { files: [new File(['zip-bytes'], 'a.zip', { type: 'application/zip' })] } },
    )
    fireEvent.click(screen.getByRole('button', { name: '移除文件' }))

    expect(screen.queryByText('a.zip')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '导入' })).toBeDisabled()
  })

  it('点击「删除」确认后调用删除接口并刷新列表', async () => {
    vi.mocked(skillApi.deleteSkill).mockResolvedValue(null)
    render(<SkillManage />)

    fireEvent.click(await screen.findByRole('button', { name: '删除 demo-skill' }))
    fireEvent.click(await screen.findByRole('button', { name: '删除' }))

    await waitFor(() => expect(skillApi.deleteSkill).toHaveBeenCalledWith('demo-skill'))
    await waitFor(() => expect(skillApi.listSkills).toHaveBeenCalledTimes(2))
  })

  it('内置 Skill 的删除按钮禁用，不可触发确认', async () => {
    render(<SkillManage />)

    expect(await screen.findByRole('button', { name: '删除 builtin-skill' })).toBeDisabled()
  })
})
