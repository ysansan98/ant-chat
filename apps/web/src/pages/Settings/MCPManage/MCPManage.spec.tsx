import type { McpConfigSchema, ToolApprovalRule } from '@ant-chat/shared'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getMcpConfigs, getMcpServers, setMcpServerEnabled, startMcpServer } from '@/api/mcpApi'
import permissionsApi from '@/api/permissionsApi'
import { useMcpConfigsStore } from '@/store/mcpConfigs'
import MCPManage from './MCPManage'

vi.mock('@/api/mcpApi', () => ({
  deleteMcpServer: vi.fn(),
  editMcpServer: vi.fn(),
  getMcpConfigByServerName: vi.fn(),
  getMcpConfigs: vi.fn(async () => []),
  getMcpServers: vi.fn(async () => []),
  installMcpServer: vi.fn(),
  setMcpServerEnabled: vi.fn(async () => ({ serverName: 'github', status: 'disconnected', transportType: 'stdio' })),
  startMcpServer: vi.fn(async () => ({ serverName: 'github', status: 'connected', transportType: 'stdio' })),
  stopMcpServer: vi.fn(),
  testMcpServer: vi.fn(),
}))

vi.mock('@/api/permissionsApi', () => ({
  default: {
    list: vi.fn(),
  },
}))

const config: McpConfigSchema = {
  enabled: true,
  serverId: '00000000-0000-4000-8000-000000000001',
  serverName: 'github',
  transportType: 'stdio',
  command: 'github-mcp',
}

const permissionRule: ToolApprovalRule = {
  id: 'rule-1',
  createdAt: 1,
  updatedAt: 1,
  kind: 'mcp-tool',
  serverName: 'github',
  toolName: 'create_issue',
}

describe('协议服务器管理页', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useMcpConfigsStore.setState({
      connections: [],
      mcpConfigs: [],
      mcpServerRuningStatusMap: {},
      selectedServerName: null,
    })
  })

  it('始终展示服务器列表入口且不再提供总开关', async () => {
    render(<MCPManage />)

    expect(screen.getByRole('heading', { name: 'MCP 设置' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /添加服务器/ })).toBeInTheDocument()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    await waitFor(() => expect(getMcpConfigs).toHaveBeenCalledOnce())
  })

  it('编辑有权限规则的服务器时提示重命名迁移数量', async () => {
    vi.mocked(getMcpConfigs).mockResolvedValue([config])
    vi.mocked(permissionsApi.list).mockResolvedValue({
      global: [permissionRule],
      workspaces: { '/workspace/app': [{ ...permissionRule, id: 'rule-2' }] },
    })
    render(<MCPManage />)

    fireEvent.click(await screen.findByRole('button', { name: '编辑服务器：github' }))

    expect(await screen.findByText('重命名将迁移 2 条权限规则')).toBeInTheDocument()
    expect(screen.getByText('保存新名称时，服务器配置与相关权限规则会由后端原子更新。')).toBeInTheDocument()
  })

  it('列表展示真实连接状态并支持行内启用开关', async () => {
    vi.mocked(getMcpConfigs).mockResolvedValue([config])
    vi.mocked(getMcpServers).mockResolvedValue([{
      name: 'github',
      config: JSON.stringify(config),
      status: 'connected',
      tools: [{
        name: 'create_issue',
        description: '创建 issue',
        inputSchema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
      }],
    }])
    render(<MCPManage />)

    expect((await screen.findAllByText('运行中')).length).toBeGreaterThan(0)
    expect(screen.getByText('create_issue')).toBeInTheDocument()
    const toggle = screen.getByRole('switch', { name: '启用服务器：github' })
    expect(toggle).toBeChecked()

    fireEvent.click(toggle)
    await waitFor(() => expect(setMcpServerEnabled).toHaveBeenCalledWith('github', false))
  })

  it('已启用但未运行的服务器提供一键启动重试', async () => {
    vi.mocked(getMcpConfigs).mockResolvedValue([config])
    vi.mocked(getMcpServers).mockResolvedValue([])
    render(<MCPManage />)

    fireEvent.click(await screen.findByRole('button', { name: '启动服务器：github' }))

    await waitFor(() => expect(startMcpServer).toHaveBeenCalledWith('github'))
  })
})
