import type { ToolApprovalRule, WorkspaceItem } from '@ant-chat/shared'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import permissionsApi from '@/api/permissionsApi'
import { WorkspaceDeleteDialog } from './WorkspaceDeleteDialog'

vi.mock('@/api/permissionsApi', () => ({
  default: {
    list: vi.fn(),
  },
}))

const item: WorkspaceItem = {
  path: '/workspace/app',
  displayName: 'app',
  isDefault: false,
}

const rule: ToolApprovalRule = {
  id: 'rule-1',
  createdAt: 1,
  updatedAt: 1,
  kind: 'mcp-tool',
  serverName: 'github',
  toolName: 'create_issue',
}

describe('删除工作区', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('存在规则时默认同时删除权限分组', async () => {
    vi.mocked(permissionsApi.list).mockResolvedValue({
      global: [],
      workspaces: { [item.path]: [rule] },
    })
    const onDelete = vi.fn(async () => {})
    render(
      <WorkspaceDeleteDialog
        item={item}
        open
        onOpenChange={vi.fn()}
        onDelete={onDelete}
      />,
    )

    const checkbox = await screen.findByRole('checkbox', { name: '同时删除 1 条权限规则' })
    expect(checkbox).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: '删除' }))

    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(item.path, true))
  })

  it('用户取消勾选时保留权限分组', async () => {
    vi.mocked(permissionsApi.list).mockResolvedValue({
      global: [],
      workspaces: { [item.path]: [rule] },
    })
    const onDelete = vi.fn(async () => {})
    render(
      <WorkspaceDeleteDialog
        item={item}
        open
        onOpenChange={vi.fn()}
        onDelete={onDelete}
      />,
    )

    const checkbox = await screen.findByRole('checkbox', { name: '同时删除 1 条权限规则' })
    fireEvent.click(checkbox)
    fireEvent.click(screen.getByRole('button', { name: '删除' }))

    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(item.path, false))
  })

  it('权限读取失败时阻止删除并允许重试检查', async () => {
    vi.mocked(permissionsApi.list)
      .mockRejectedValueOnce(new Error('权限文件不可读'))
      .mockResolvedValueOnce({ global: [], workspaces: {} })
    const onDelete = vi.fn(async () => {})
    render(
      <WorkspaceDeleteDialog
        item={item}
        open
        onOpenChange={vi.fn()}
        onDelete={onDelete}
      />,
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('权限文件不可读')
    expect(screen.getByRole('button', { name: '重试删除' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '重试检查' }))

    await waitFor(() => expect(permissionsApi.list).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('button', { name: '删除' })).toBeEnabled()
  })

  it('删除失败后保留弹窗并允许重试', async () => {
    vi.mocked(permissionsApi.list).mockResolvedValue({ global: [], workspaces: {} })
    const onDelete = vi
      .fn<(path: string, deletePermissionGroup: boolean) => Promise<void>>()
      .mockRejectedValueOnce(new Error('工作区正在使用'))
      .mockResolvedValueOnce()
    render(
      <WorkspaceDeleteDialog
        item={item}
        open
        onOpenChange={vi.fn()}
        onDelete={onDelete}
      />,
    )
    await waitFor(() => expect(permissionsApi.list).toHaveBeenCalledOnce())

    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('工作区正在使用')
    fireEvent.click(screen.getByRole('button', { name: '重试删除' }))

    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(2))
  })
})
