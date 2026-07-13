import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getMcpConfigs } from '@/api/mcpApi'
import { useMcpConfigsStore } from '@/store/mcpConfigs'
import MCPManage from './MCPManage'

vi.mock('@/api/mcpApi', () => ({
  addMcpConfig: vi.fn(),
  connectMcpServer: vi.fn(),
  deleteMcpConfig: vi.fn(),
  disconnectMcpServer: vi.fn(),
  getMcpConfigByServerName: vi.fn(),
  getMcpConfigs: vi.fn(async () => []),
  reconnectMcpServer: vi.fn(),
  updateMcpConfig: vi.fn(),
}))

describe('mcpManage', () => {
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
})
