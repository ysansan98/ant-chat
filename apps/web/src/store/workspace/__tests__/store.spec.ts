import type { ListWorkspacesData } from '@ant-chat/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useWorkspaceStore } from '../store'

const mocks = vi.hoisted(() => ({
  listWorkspaces: vi.fn(),
  addWorkspace: vi.fn(),
  removeWorkspace: vi.fn(),
  reorderWorkspaces: vi.fn(),
}))

vi.mock('@/api/workspaceApi', () => ({
  default: mocks,
}))

function makeWorkspaces(paths: Array<{ path: string, lastOpenedAt: number }>): ListWorkspacesData {
  return {
    workspaces: paths.map(item => ({
      path: item.path,
      displayName: item.path,
      isDefault: false,
      lastOpenedAt: item.lastOpenedAt,
    })),
  }
}

describe('workspaceStore currentWorkspacePath SSOT', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useWorkspaceStore.setState({ workspaceData: null, currentWorkspacePath: '', loading: false })
  })

  it('refresh 后 currentWorkspacePath 派生为 lastOpenedAt 最大者', async () => {
    mocks.listWorkspaces.mockResolvedValue(makeWorkspaces([
      { path: '/a', lastOpenedAt: 1 },
      { path: '/b', lastOpenedAt: 5 },
      { path: '/c', lastOpenedAt: 3 },
    ]))

    await useWorkspaceStore.getState().refresh()

    expect(useWorkspaceStore.getState().currentWorkspacePath).toBe('/b')
  })

  it('refresh 后若当前路径仍有效则保持不变', async () => {
    useWorkspaceStore.setState({ currentWorkspacePath: '/c' })
    mocks.listWorkspaces.mockResolvedValue(makeWorkspaces([
      { path: '/a', lastOpenedAt: 1 },
      { path: '/c', lastOpenedAt: 3 },
    ]))

    await useWorkspaceStore.getState().refresh()

    expect(useWorkspaceStore.getState().currentWorkspacePath).toBe('/c')
  })

  it('refresh 后若当前路径不在列表则回退到 lastOpenedAt 最大者', async () => {
    useWorkspaceStore.setState({ currentWorkspacePath: '/gone' })
    mocks.listWorkspaces.mockResolvedValue(makeWorkspaces([
      { path: '/a', lastOpenedAt: 1 },
      { path: '/b', lastOpenedAt: 9 },
    ]))

    await useWorkspaceStore.getState().refresh()

    expect(useWorkspaceStore.getState().currentWorkspacePath).toBe('/b')
  })

  it('addWorkspace 后 currentWorkspacePath 显式设置为目标路径', async () => {
    mocks.addWorkspace.mockResolvedValue(makeWorkspaces([{ path: '/new', lastOpenedAt: 10 }]))

    await useWorkspaceStore.getState().addWorkspace('/new')

    expect(useWorkspaceStore.getState().currentWorkspacePath).toBe('/new')
  })

  it('removeWorkspace 删除当前工作区后回退到 lastOpenedAt 最大者', async () => {
    useWorkspaceStore.setState({
      currentWorkspacePath: '/cur',
      workspaceData: makeWorkspaces([
        { path: '/cur', lastOpenedAt: 5 },
        { path: '/other', lastOpenedAt: 8 },
      ]),
    })
    mocks.removeWorkspace.mockResolvedValue(makeWorkspaces([{ path: '/other', lastOpenedAt: 8 }]))

    await useWorkspaceStore.getState().removeWorkspace('/cur', true)

    expect(useWorkspaceStore.getState().currentWorkspacePath).toBe('/other')
    expect(mocks.removeWorkspace).toHaveBeenCalledWith('/cur', true)
  })

  it('removeWorkspace 删除非当前工作区时 currentWorkspacePath 保持不变', async () => {
    useWorkspaceStore.setState({
      currentWorkspacePath: '/cur',
      workspaceData: makeWorkspaces([
        { path: '/cur', lastOpenedAt: 5 },
        { path: '/other', lastOpenedAt: 8 },
      ]),
    })
    mocks.removeWorkspace.mockResolvedValue(makeWorkspaces([{ path: '/cur', lastOpenedAt: 5 }]))

    await useWorkspaceStore.getState().removeWorkspace('/other', false)

    expect(useWorkspaceStore.getState().currentWorkspacePath).toBe('/cur')
    expect(mocks.removeWorkspace).toHaveBeenCalledWith('/other', false)
  })

  it('reorderWorkspaces 后只更新列表顺序并保持当前工作区', async () => {
    useWorkspaceStore.setState({
      currentWorkspacePath: '/b',
      workspaceData: makeWorkspaces([
        { path: '/a', lastOpenedAt: 1 },
        { path: '/b', lastOpenedAt: 5 },
        { path: '/c', lastOpenedAt: 3 },
      ]),
    })
    mocks.reorderWorkspaces.mockResolvedValue(makeWorkspaces([
      { path: '/c', lastOpenedAt: 3 },
      { path: '/a', lastOpenedAt: 1 },
      { path: '/b', lastOpenedAt: 5 },
    ]))

    await useWorkspaceStore.getState().reorderWorkspaces(['/c', '/a', '/b'])

    expect(useWorkspaceStore.getState().workspaceData?.workspaces.map(item => item.path)).toEqual(['/c', '/a', '/b'])
    expect(useWorkspaceStore.getState().currentWorkspacePath).toBe('/b')
  })
})
