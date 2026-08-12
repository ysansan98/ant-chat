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

  it('单个「导入 Skill」按钮打开弹窗，内置 ZIP 与 GitHub 两个导入方式', async () => {
    render(<SkillManage />)

    fireEvent.click(await screen.findByRole('button', { name: '导入 Skill' }))

    expect(await screen.findByRole('tab', { name: 'ZIP 文件' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'GitHub URL' })).toBeInTheDocument()
  })

  it('通过 GitHub URL 导入：输入地址点「导入」调用接口并关闭弹窗', async () => {
    vi.mocked(skillApi.importSkill).mockResolvedValue(skill('github-skill'))
    render(<SkillManage />)

    fireEvent.click(await screen.findByRole('button', { name: '导入 Skill' }))
    fireEvent.change(
      await screen.findByPlaceholderText(/github\.com/),
      { target: { value: 'https://github.com/org/skill-repo' } },
    )
    fireEvent.click(screen.getByRole('button', { name: '导入' }))

    await waitFor(() => expect(skillApi.importSkill).toHaveBeenCalledWith(
      { source: 'github', url: 'https://github.com/org/skill-repo' },
    ))
    await waitFor(() => expect(screen.queryByRole('tab', { name: 'GitHub URL' })).not.toBeInTheDocument())
  })

  it('zIP 导入：选择 .zip 文件后点「导入」调用接口并关闭弹窗', async () => {
    const file = new File(['zip-bytes'], 'demo-skill.zip', { type: 'application/zip' })
    vi.mocked(skillApi.importSkill).mockResolvedValue(skill('zip-skill'))
    render(<SkillManage />)

    fireEvent.click(await screen.findByRole('button', { name: '导入 Skill' }))
    fireEvent.click(await screen.findByRole('tab', { name: 'ZIP 文件' }))
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
    await waitFor(() => expect(screen.queryByRole('tab', { name: 'ZIP 文件' })).not.toBeInTheDocument())
  })

  it('zIP 导入：选择非 .zip 文件被拒绝且不触发导入', async () => {
    render(<SkillManage />)

    fireEvent.click(await screen.findByRole('button', { name: '导入 Skill' }))
    fireEvent.click(await screen.findByRole('tab', { name: 'ZIP 文件' }))
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

    fireEvent.click(await screen.findByRole('button', { name: '导入 Skill' }))
    fireEvent.click(await screen.findByRole('tab', { name: 'ZIP 文件' }))
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
