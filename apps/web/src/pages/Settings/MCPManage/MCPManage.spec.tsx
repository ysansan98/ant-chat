import type { McpConfigSchema, ToolApprovalRule } from '@ant-chat/shared'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getMcpConfigs } from '@/api/mcpApi'
import permissionsApi from '@/api/permissionsApi'
import { useMcpConfigsStore } from '@/store/mcpConfigs'
import MCPManage from './MCPManage'

vi.mock('@/api/mcpApi', () => ({
  deleteMcpServer: vi.fn(),
  editMcpServer: vi.fn(),
  getMcpConfigByServerName: vi.fn(),
  getMcpConfigs: vi.fn(async () => []),
  installMcpServer: vi.fn(),
  startMcpServer: vi.fn(),
  stopMcpServer: vi.fn(),
  testMcpServer: vi.fn(),
}))

vi.mock('@/api/permissionsApi', () => ({
  default: {
    list: vi.fn(),
  },
}))

const config: McpConfigSchema = {
  serverName: 'github',
  icon: '🐙',
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
      mcpConfigs: [],
      mcpServerRuningStatusMap: {},
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
})
