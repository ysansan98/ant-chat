import type { ToolApprovalRule } from '@ant-chat/shared'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import permissionsApi from '@/api/permissionsApi'
import workspaceApi from '@/api/workspaceApi'
import { useWorkspaceStore } from '@/store/workspace'
import { PermissionsPage } from './Permissions'

/** 模拟 base-ui Select 组件的选择交互 */
async function selectOption(triggerLabel: string, optionLabel: string) {
  const trigger = screen.getByRole('combobox', { name: triggerLabel })
  await userEvent.click(trigger)
  const option = await screen.findByRole('option', { name: optionLabel })
  await userEvent.click(option)
}

vi.mock('@/api/permissionsApi', () => ({
  default: {
    add: vi.fn(),
    clear: vi.fn(),
    clearWorkspace: vi.fn(),
    list: vi.fn(),
    remove: vi.fn(),
    update: vi.fn(),
  },
}))

vi.mock('@/api/workspaceApi', () => ({
  default: {
    createDirectory: vi.fn(),
    listDirectories: vi.fn(),
  },
}))

const bashRule: ToolApprovalRule = {
  id: 'bash-1',
  createdAt: 1,
  updatedAt: 1,
  kind: 'command',
  interpreter: 'bash',
  executable: 'git',
  argvPrefix: ['status'],
  allowRemainingArgs: false,
  resourceScope: 'workspace',
}

describe('权限管理页', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useWorkspaceStore.setState({
      currentWorkspacePath: '/workspace/app',
      workspaceData: {
        workspaces: [{
          path: '/workspace/app',
          displayName: 'app',
          isDefault: false,
        }],
      },
      loading: false,
    })
  })

  it('加载失败时显示错误并允许重试', async () => {
    vi.mocked(permissionsApi.list)
      .mockRejectedValueOnce(new Error('权限文件损坏'))
      .mockResolvedValueOnce({ global: [], workspaces: {} })

    render(<PermissionsPage />)

    expect(await screen.findByRole('alert')).toHaveTextContent('权限文件损坏')
    fireEvent.click(screen.getByRole('button', { name: '重试加载' }))

    expect(await screen.findByText('暂无权限规则')).toBeInTheDocument()
    expect(permissionsApi.list).toHaveBeenCalledTimes(2)
  })

  it('添加命令规则时提交解释器和结构化能力字段', async () => {
    vi.mocked(permissionsApi.list).mockResolvedValue({ global: [], workspaces: {} })
    vi.mocked(permissionsApi.add).mockResolvedValue({
      ...bashRule,
      argvPrefix: ['show', 'HEAD'],
      allowRemainingArgs: true,
    })
    render(<PermissionsPage />)
    await screen.findByText('暂无权限规则')

    fireEvent.click(screen.getByRole('button', { name: '添加规则' }))
    fireEvent.change(screen.getByRole('textbox', { name: '命令' }), { target: { value: 'git' } })
    fireEvent.change(screen.getByRole('textbox', { name: '固定参数' }), { target: { value: 'show\nHEAD' } })
    fireEvent.click(screen.getByRole('checkbox', { name: '允许在固定参数后追加任意数量参数' }))
    fireEvent.click(screen.getByRole('button', { name: '保存规则' }))

    await waitFor(() => expect(permissionsApi.add).toHaveBeenCalledWith({
      scope: 'global',
      workspacePath: undefined,
      rule: {
        kind: 'command',
        effect: 'allow',
        interpreter: 'bash',
        executable: 'git',
        argvPrefix: ['show', 'HEAD'],
        allowRemainingArgs: true,
        resourceScope: 'workspace',
      },
    }))
    expect(await screen.findByText('Bash · git show HEAD [可追加任意数量参数]')).toBeInTheDocument()
  })

  it('审批命令经过 PATH shim 时仍展示用户授权的命令名', async () => {
    vi.mocked(permissionsApi.list).mockResolvedValue({
      global: [{
        ...bashRule,
        executable: 'node',
        argvPrefix: ['/skills/example/run.js'],
      }],
      workspaces: {},
    })

    render(<PermissionsPage />)

    expect(await screen.findByText('Bash · node /skills/example/run.js')).toBeInTheDocument()
    expect(screen.queryByText('nub /skills/example/run.js')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '编辑规则：Bash · node /skills/example/run.js' }))
    expect(screen.getByRole('textbox', { name: '命令' })).toHaveValue('node')
  })

  it('添加目录读取规则时固定为递归读取并保存到选定工作区', async () => {
    const directoryRule: ToolApprovalRule = {
      id: 'fs-1',
      createdAt: 1,
      updatedAt: 1,
      kind: 'filesystem',
      access: 'read',
      targetType: 'directory',
      canonicalPath: '/workspace/app/docs',
      recursive: true,
    }
    vi.mocked(permissionsApi.list).mockResolvedValue({ global: [], workspaces: {} })
    vi.mocked(permissionsApi.add).mockResolvedValue(directoryRule)
    vi.mocked(workspaceApi.listDirectories).mockResolvedValue({
      currentPath: '/workspace/app',
      parentPath: '/workspace',
      roots: ['/'],
      directories: [{ name: 'docs', path: '/workspace/app/docs' }],
    })
    render(<PermissionsPage />)
    await screen.findByText('暂无权限规则')

    fireEvent.click(screen.getByRole('button', { name: '添加规则' }))
    await selectOption('规则类型', '文件系统')
    await selectOption('生效范围', '/workspace/app')
    await selectOption('目标类型', '目录递归读取')
    fireEvent.click(screen.getByRole('button', { name: '选择目录' }))
    expect(await screen.findByRole('dialog', { name: '选择权限目录' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'docs' }))
    fireEvent.click(screen.getByRole('button', { name: '选择此目录' }))
    expect(screen.getByRole('textbox', { name: '文件或目录路径' })).toHaveValue('/workspace/app/docs')
    fireEvent.click(screen.getByRole('button', { name: '保存规则' }))

    await waitFor(() => expect(permissionsApi.add).toHaveBeenCalledWith({
      scope: 'workspace',
      workspacePath: '/workspace/app',
      rule: {
        kind: 'filesystem',
        effect: 'allow',
        access: 'read',
        targetType: 'directory',
        canonicalPath: '/workspace/app/docs',
        recursive: true,
      },
    }))
    expect(await screen.findByText('读取 目录 /workspace/app/docs（递归）')).toBeInTheDocument()
  })

  it('添加 MCP 规则时明确提交服务器与工具身份', async () => {
    const mcpRule: ToolApprovalRule = {
      id: 'mcp-1',
      createdAt: 1,
      updatedAt: 1,
      kind: 'mcp-tool',
      serverName: 'github',
      toolName: 'create_issue',
    }
    vi.mocked(permissionsApi.list).mockResolvedValue({ global: [], workspaces: {} })
    vi.mocked(permissionsApi.add).mockResolvedValue(mcpRule)
    render(<PermissionsPage />)
    await screen.findByText('暂无权限规则')

    fireEvent.click(screen.getByRole('button', { name: '添加规则' }))
    await selectOption('规则类型', 'MCP 工具')
    fireEvent.change(screen.getByRole('textbox', { name: 'MCP 服务器名称' }), { target: { value: 'github' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'MCP 工具名称' }), { target: { value: 'create_issue' } })
    fireEvent.click(screen.getByRole('button', { name: '保存规则' }))

    await waitFor(() => expect(permissionsApi.add).toHaveBeenCalledWith(expect.objectContaining({
      rule: {
        kind: 'mcp-tool',
        effect: 'allow',
        serverName: 'github',
        toolName: 'create_issue',
      },
    })))
    expect(await screen.findByText('github → create_issue')).toBeInTheDocument()
  })

  it('添加 browser 规则时提交工具名和域名限制', async () => {
    const browserRule: ToolApprovalRule = {
      id: 'browser-1',
      createdAt: 1,
      updatedAt: 1,
      kind: 'browser',
      toolName: 'browser_navigate',
      urlPattern: '*.github.com',
    }
    vi.mocked(permissionsApi.list).mockResolvedValue({ global: [], workspaces: {} })
    vi.mocked(permissionsApi.add).mockResolvedValue(browserRule)
    render(<PermissionsPage />)
    await screen.findByText('暂无权限规则')

    fireEvent.click(screen.getByRole('button', { name: '添加规则' }))
    await selectOption('规则类型', '浏览器')
    fireEvent.change(screen.getByRole('textbox', { name: '浏览器工具名称' }), { target: { value: 'browser_navigate' } })
    fireEvent.change(screen.getByRole('textbox', { name: '限制域名' }), { target: { value: '*.github.com' } })
    fireEvent.click(screen.getByRole('button', { name: '保存规则' }))

    await waitFor(() => expect(permissionsApi.add).toHaveBeenCalledWith(expect.objectContaining({
      rule: {
        kind: 'browser',
        effect: 'allow',
        toolName: 'browser_navigate',
        urlPattern: '*.github.com',
      },
    })))
    expect(await screen.findByText('browser_navigate (*.github.com)')).toBeInTheDocument()
  })

  it('编辑规则时保留稳定身份并只提交新的能力字段', async () => {
    vi.mocked(permissionsApi.list).mockResolvedValue({ global: [bashRule], workspaces: {} })
    vi.mocked(permissionsApi.update).mockResolvedValue({ ...bashRule, argvPrefix: ['show'] })
    render(<PermissionsPage />)
    await screen.findByText('Bash · git status')

    fireEvent.click(screen.getByRole('button', { name: '编辑规则：Bash · git status' }))
    fireEvent.change(screen.getByRole('textbox', { name: '固定参数' }), { target: { value: 'show' } })
    fireEvent.click(screen.getByRole('button', { name: '保存规则' }))

    await waitFor(() => expect(permissionsApi.update).toHaveBeenCalledWith({
      ruleId: 'bash-1',
      scope: 'global',
      workspacePath: undefined,
      rule: {
        kind: 'command',
        effect: 'allow',
        interpreter: 'bash',
        executable: 'git',
        argvPrefix: ['show'],
        allowRemainingArgs: false,
        resourceScope: 'workspace',
      },
    }))
    expect(await screen.findByText('Bash · git show')).toBeInTheDocument()
  })

  it('保存失败时保留表单内容并允许重试', async () => {
    vi.mocked(permissionsApi.list).mockResolvedValue({ global: [], workspaces: {} })
    vi.mocked(permissionsApi.add)
      .mockRejectedValueOnce(new Error('规则冲突'))
      .mockResolvedValueOnce(bashRule)
    render(<PermissionsPage />)
    await screen.findByText('暂无权限规则')

    fireEvent.click(screen.getByRole('button', { name: '添加规则' }))
    fireEvent.change(screen.getByRole('textbox', { name: '命令' }), { target: { value: 'git' } })
    fireEvent.change(screen.getByRole('textbox', { name: '固定参数' }), { target: { value: 'status' } })
    fireEvent.click(screen.getByRole('button', { name: '保存规则' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('规则冲突')
    expect(screen.getByRole('textbox', { name: '命令' })).toHaveValue('git')
    fireEvent.click(screen.getByRole('button', { name: '重试保存' }))

    await waitFor(() => expect(permissionsApi.add).toHaveBeenCalledTimes(2))
  })

  it('命令任意参数规则必须经过独立确认步骤', async () => {
    vi.mocked(permissionsApi.list).mockResolvedValue({ global: [], workspaces: {} })
    vi.mocked(permissionsApi.add).mockResolvedValue({
      ...bashRule,
      argvPrefix: [],
      allowRemainingArgs: true,
    })
    render(<PermissionsPage />)
    await screen.findByText('暂无权限规则')

    fireEvent.click(screen.getByRole('button', { name: '添加规则' }))
    fireEvent.change(screen.getByRole('textbox', { name: '命令' }), { target: { value: 'git' } })
    fireEvent.click(screen.getByRole('checkbox', { name: '允许在固定参数后追加任意数量参数' }))
    fireEvent.click(screen.getByRole('button', { name: '保存规则' }))

    expect(permissionsApi.add).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: '确认允许命令使用任意参数' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确认并保存' }))

    await waitFor(() => expect(permissionsApi.add).toHaveBeenCalledWith(expect.objectContaining({
      rule: expect.objectContaining({
        kind: 'command',
        argvPrefix: [],
        allowRemainingArgs: true,
      }),
    })))
  })

  it('添加黑名单规则时保存 deny 效果并明确展示', async () => {
    vi.mocked(permissionsApi.list).mockResolvedValue({ global: [], workspaces: {} })
    vi.mocked(permissionsApi.add).mockResolvedValue({ ...bashRule, effect: 'deny' })
    render(<PermissionsPage />)
    await screen.findByText('暂无权限规则')

    fireEvent.click(screen.getByRole('button', { name: '添加规则' }))
    fireEvent.change(screen.getByRole('textbox', { name: '命令' }), { target: { value: 'git' } })
    fireEvent.change(screen.getByRole('textbox', { name: '固定参数' }), { target: { value: 'push' } })
    await selectOption('规则效果', '黑名单：命中后直接阻止')
    fireEvent.click(screen.getByRole('button', { name: '保存规则' }))

    await waitFor(() => expect(permissionsApi.add).toHaveBeenCalledWith(expect.objectContaining({
      rule: expect.objectContaining({ effect: 'deny', executable: 'git', argvPrefix: ['push'] }),
    })))
    expect(await screen.findByText('黑名单')).toBeInTheDocument()
  })

  it('规则保存成功后可以再次编辑同一条规则', async () => {
    vi.mocked(permissionsApi.list).mockResolvedValue({ global: [bashRule], workspaces: {} })
    vi.mocked(permissionsApi.update)
      .mockResolvedValueOnce({ ...bashRule, argvPrefix: ['show'] })
      .mockResolvedValueOnce({ ...bashRule, argvPrefix: ['log'] })
    render(<PermissionsPage />)
    await screen.findByText('Bash · git status')

    fireEvent.click(screen.getByRole('button', { name: '编辑规则：Bash · git status' }))
    fireEvent.change(screen.getByRole('textbox', { name: '固定参数' }), { target: { value: 'show' } })
    fireEvent.click(screen.getByRole('button', { name: '保存规则' }))
    await screen.findByText('Bash · git show')

    fireEvent.click(screen.getByRole('button', { name: '编辑规则：Bash · git show' }))
    expect(screen.getByRole('button', { name: '保存规则' })).toBeEnabled()
    fireEvent.change(screen.getByRole('textbox', { name: '固定参数' }), { target: { value: 'log' } })
    fireEvent.click(screen.getByRole('button', { name: '保存规则' }))

    expect(await screen.findByText('Bash · git log')).toBeInTheDocument()
    expect(permissionsApi.update).toHaveBeenCalledTimes(2)
  })
})
