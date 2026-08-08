import type { ChannelAccountView, ChannelPairing } from '@ant-chat/shared'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteChannel, disableChannel, listChannelPairings, listChannels } from '@/api/channelApi'
import workspaceApi from '@/api/workspaceApi'
import { ChannelsPage } from './Channels'

vi.mock('@/api/channelApi', () => ({
  listChannels: vi.fn(),
  createChannel: vi.fn(),
  deleteChannel: vi.fn(),
  disableChannel: vi.fn(),
  enableChannel: vi.fn(),
  getChannelSetupStatus: vi.fn(),
  listChannelPairings: vi.fn(),
  approveChannelPairing: vi.fn(),
  revokeChannelPairing: vi.fn(),
}))

vi.mock('@/api/workspaceApi', () => ({
  default: { listWorkspaces: vi.fn() },
}))

describe('channelsPage 平台槽位布局', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(workspaceApi.listWorkspaces).mockResolvedValue({ workspaces: [] })
  })

  it('未接入任何频道时，按平台铺出固定槽位，飞书与个人微信都可接入', async () => {
    vi.mocked(listChannels).mockResolvedValue([])

    render(<ChannelsPage />)

    expect(await screen.findByText('飞书私聊')).toBeInTheDocument()
    expect(screen.getByText('个人微信')).toBeInTheDocument()
    const connectButtons = screen.getAllByRole('button', { name: '接入' })
    expect(connectButtons).toHaveLength(2)
    expect(connectButtons[0]).toBeEnabled()
    expect(connectButtons[1]).toBeEnabled()
  })

  it('已接入的平台不再显示「接入」入口，行内展示名称、状态与默认工作区', async () => {
    vi.mocked(listChannels).mockResolvedValue([channelView()])
    vi.mocked(listChannelPairings).mockResolvedValue([])

    render(<ChannelsPage />)

    expect(await screen.findByText('团队飞书')).toBeInTheDocument()
    expect(screen.getByText('飞书私聊')).toBeInTheDocument()
    expect(screen.getByText('已连接')).toBeInTheDocument()
    expect(screen.getByText(/\/Users\/ysansan\/team/)).toBeInTheDocument()
    // 只剩余个人微信的可用入口
    expect(screen.getByRole('button', { name: '接入' })).toBeEnabled()
  })

  it('用开关停用频道，并同步状态徽标', async () => {
    const channel = channelView()
    vi.mocked(listChannels).mockImplementation(async () => [channel])
    vi.mocked(listChannelPairings).mockResolvedValue([])
    vi.mocked(disableChannel).mockResolvedValue({ id: 'channel-1', enabled: false, status: 'disconnected' })

    render(<ChannelsPage />)

    const toggle = await screen.findByRole('switch', { name: '停用频道' })
    expect(toggle).toBeChecked()

    fireEvent.click(toggle)
    await waitFor(() => expect(disableChannel).toHaveBeenCalledWith('channel-1'))

    // 后端返回停用后，刷新出的频道状态同步为已停用
    channel.enabled = false
    channel.status = 'disconnected'
    expect(await screen.findByText('已停用')).toBeInTheDocument()
  })

  it('展示待批准配对数量，展开后可以批准或拒绝', async () => {
    const channel = channelView()
    const pairing: ChannelPairing = { id: 'p1', channelAccountId: channel.id, externalUserId: 'u_zhangsan', externalDisplayName: '张三', status: 'pending', requestedAt: 1 }
    vi.mocked(listChannels).mockResolvedValue([channel])
    vi.mocked(listChannelPairings).mockResolvedValue([pairing])

    render(<ChannelsPage />)

    const pairingsButton = await screen.findByRole('button', { name: /配对请求/ })
    await waitFor(() => expect(pairingsButton).toHaveTextContent('1'))

    fireEvent.click(pairingsButton)
    expect(await screen.findByText('张三')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '批准' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '拒绝' })).toBeInTheDocument()
  })

  it('微信行不展示配对请求，仍保留重新授权与删除入口', async () => {
    vi.mocked(listChannels).mockResolvedValue([channelView({ channelType: 'weixin', displayName: '我的微信' })])
    vi.mocked(listChannelPairings).mockResolvedValue([])

    render(<ChannelsPage />)

    expect(await screen.findByText('我的微信')).toBeInTheDocument()
    // 微信只连接本机 owner 的单个微信，无配对流程：不渲染按钮也不发起接口调用。
    expect(screen.queryByRole('button', { name: /配对请求/ })).not.toBeInTheDocument()
    expect(listChannelPairings).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '重新授权' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '删除频道' })).toBeInTheDocument()
  })

  it('删除频道前需要确认', async () => {
    vi.mocked(listChannels).mockResolvedValue([channelView()])
    vi.mocked(listChannelPairings).mockResolvedValue([])
    vi.mocked(deleteChannel).mockResolvedValue(null)

    render(<ChannelsPage />)

    fireEvent.click(await screen.findByRole('button', { name: '删除频道' }))
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(deleteChannel).toHaveBeenCalledWith('channel-1'))
  })
})

function channelView(overrides: Partial<ChannelAccountView> = {}): ChannelAccountView {
  return {
    id: 'channel-1',
    channelType: 'feishu',
    displayName: '团队飞书',
    defaultWorkspacePath: '/Users/ysansan/team',
    permissionMode: 'hybrid',
    enabled: true,
    status: 'connected',
    createdAt: 0,
    updatedAt: 0,
    hasCredential: true,
    ...overrides,
  }
}
