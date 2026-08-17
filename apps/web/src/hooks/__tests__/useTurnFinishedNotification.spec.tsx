import type { IConversations } from '@ant-chat/shared'
import { act, render } from '@testing-library/react'
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useConversationsStore } from '@/store/conversation'
import { activatePersistedConversationSession } from '@/store/workspaceSession'

import { ipc } from '@/utils/ipc-bus'
import { useTurnFinishedNotification } from '../useTurnFinishedNotification'

const { emitEvent, eventHandlers } = vi.hoisted(() => {
  const handlers = new Map<string, (payload: unknown) => void>()
  return {
    emitEvent: (channel: string, payload: unknown) => handlers.get(channel)?.(payload),
    eventHandlers: handlers,
  }
})

vi.mock('@/api/transports/appEventSubscriptions', () => ({
  getAppEventSubscriptions: () => ({
    subscribe: (channel: string, handler: (payload: unknown) => void) => {
      eventHandlers.set(channel, handler)
      return () => eventHandlers.delete(channel)
    },
  }),
}))

vi.mock('@/store/workspaceSession', () => ({
  activatePersistedConversationSession: vi.fn(async () => {}),
}))

vi.mock('@/utils/ipc-bus', () => ({
  isElectronRuntime: vi.fn(() => true),
  ipc: { app: { focusWindow: vi.fn(async () => {}) } },
}))

class NotificationMock {
  static permission: NotificationPermission = 'granted'
  static requestPermission = vi.fn(async () => 'granted' as NotificationPermission)
  static instances: NotificationMock[] = []

  title: string
  options: NotificationOptions
  onclick: (() => void) | null = null
  close = vi.fn()

  constructor(title: string, options: NotificationOptions) {
    this.title = title
    this.options = options
    NotificationMock.instances.push(this)
  }
}

function createConversation(id: string, title: string): IConversations {
  return {
    createdAt: 1,
    id,
    conversationInstructions: '',
    settings: {
      compaction: { enabled: true, keepRecentTokens: 20_000, thresholdPercent: 70 },
      maxOutputTokens: 1000,
      modelId: '',
      providerId: '',
      temperature: 0.7,
    },
    title,
    updatedAt: 1,
    workspacePath: '/tmp/ws',
  } as IConversations
}

function setup() {
  const locations: string[] = []

  function Probe() {
    const location = useLocation()
    locations.push(location.pathname)
    useTurnFinishedNotification()
    return null
  }

  const router = createMemoryRouter(
    [
      { path: '/settings', element: <Probe /> },
      { path: '/chat', element: <Probe /> },
    ],
    { initialEntries: ['/settings'] },
  )
  const view = render(<RouterProvider router={router} />)
  return { view, locations }
}

describe('useTurnFinishedNotification', () => {
  beforeEach(() => {
    NotificationMock.permission = 'granted'
    NotificationMock.requestPermission.mockClear()
    NotificationMock.instances = []
    eventHandlers.clear()
    vi.clearAllMocks()
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    vi.stubGlobal('Notification', NotificationMock)
    useConversationsStore.setState({ conversations: [createConversation('conv-1', '帮我写周报')] })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('应用失焦时 turn 完成发送系统通知', async () => {
    setup()
    emitEvent('agent:turn-finished', {
      conversationId: 'conv-1',
      turnId: 'turn-1',
      status: 'success',
    })

    await vi.waitFor(() => {
      expect(NotificationMock.instances).toHaveLength(1)
    })
    const notification = NotificationMock.instances[0]
    expect(notification.title).toBe('任务完成')
    expect(notification.options.body).toContain('帮我写周报')
  })

  it('点击通知跳转到对应会话并聚焦窗口', async () => {
    const { locations } = setup()
    emitEvent('agent:turn-finished', {
      conversationId: 'conv-1',
      turnId: 'turn-1',
      status: 'success',
    })

    await vi.waitFor(() => {
      expect(NotificationMock.instances).toHaveLength(1)
    })

    act(() => {
      NotificationMock.instances[0].onclick?.()
    })

    expect(ipc.app.focusWindow).toHaveBeenCalledTimes(1)
    expect(activatePersistedConversationSession).toHaveBeenCalledWith('conv-1')
    expect(NotificationMock.instances[0].close).toHaveBeenCalled()
    expect(locations).toContain('/chat')
  })

  it('应用有焦点时不发通知', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    setup()
    emitEvent('agent:turn-finished', {
      conversationId: 'conv-1',
      turnId: 'turn-1',
      status: 'success',
    })
    await Promise.resolve()
    expect(NotificationMock.instances).toHaveLength(0)
  })

  it('取消的 turn 不发通知', async () => {
    setup()
    emitEvent('agent:turn-finished', {
      conversationId: 'conv-1',
      turnId: 'turn-1',
      status: 'cancel',
    })
    await Promise.resolve()
    expect(NotificationMock.instances).toHaveLength(0)
  })

  it('权限为 default 时先申请权限，授予后发送通知', async () => {
    NotificationMock.permission = 'default'
    setup()
    emitEvent('agent:turn-finished', {
      conversationId: 'conv-1',
      turnId: 'turn-1',
      status: 'error',
    })

    await vi.waitFor(() => {
      expect(NotificationMock.requestPermission).toHaveBeenCalled()
      expect(NotificationMock.instances).toHaveLength(1)
    })
    expect(NotificationMock.instances[0].title).toBe('任务失败')
  })
})
