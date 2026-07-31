import type { McpConfigSchema, ToolApprovalRule } from '@ant-chat/shared'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import permissionsApi from '@/api/permissionsApi'
import { McpDeleteDialog } from './McpDeleteDialog'

vi.mock('@/api/permissionsApi', () => ({
  default: { list: vi.fn() },
}))

const item: McpConfigSchema = {
  serverId: '00000000-0000-4000-8000-000000000001',
  serverName: 'github',
  icon: '🐙',
  transportType: 'stdio',
  command: 'github-mcp',
}

const rule: ToolApprovalRule = {
  id: 'mcp-rule',
  createdAt: 1,
  updatedAt: 1,
  kind: 'mcp-tool',
  serverName: 'github',
  toolName: 'create_issue',
}

describe('删除 MCP 服务器', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('汇总全局和工作区规则并默认同时删除', async () => {
    vi.mocked(permissionsApi.list).mockResolvedValue({
      global: [rule],
      workspaces: { '/workspace/app': [{ ...rule, id: 'workspace-rule' }] },
    })
    const onDelete = vi.fn(async () => {})
    render(
      <McpDeleteDialog
        item={item}
        open
        onOpenChange={vi.fn()}
        onDelete={onDelete}
      />,
    )

    const checkbox = await screen.findByRole('checkbox', { name: '同时删除 2 条相关权限规则' })
    expect(checkbox).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: '删除' }))

    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(true))
  })

  it('取消勾选时保留同名重建可恢复的规则', async () => {
    vi.mocked(permissionsApi.list).mockResolvedValue({ global: [rule], workspaces: {} })
    const onDelete = vi.fn(async () => {})
    render(
      <McpDeleteDialog
        item={item}
        open
        onOpenChange={vi.fn()}
        onDelete={onDelete}
      />,
    )

    const checkbox = await screen.findByRole('checkbox', { name: '同时删除 1 条相关权限规则' })
    fireEvent.click(checkbox)
    fireEvent.click(screen.getByRole('button', { name: '删除' }))

    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(false))
  })

  it('删除失败后显示错误并允许重试', async () => {
    vi.mocked(permissionsApi.list).mockResolvedValue({ global: [], workspaces: {} })
    const onDelete = vi
      .fn<(deletePermissionRules: boolean) => Promise<void>>()
      .mockRejectedValueOnce(new Error('服务仍在运行'))
      .mockResolvedValueOnce()
    render(
      <McpDeleteDialog
        item={item}
        open
        onOpenChange={vi.fn()}
        onDelete={onDelete}
      />,
    )
    await waitFor(() => expect(permissionsApi.list).toHaveBeenCalledOnce())

    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('服务仍在运行')
    fireEvent.click(screen.getByRole('button', { name: '重试删除' }))

    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(2))
  })
})
