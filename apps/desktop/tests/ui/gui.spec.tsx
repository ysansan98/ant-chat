import type { AgentTaskSnapshot, IConversations, IMessage } from '@ant-chat/shared'

import { tmpdir } from 'node:os'
import path from 'node:path'

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, Navigate, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AppWrapper from '../../../web/src/App'
import { ChatPage } from '../../../web/src/pages/Chat'
import SettingsPage from '../../../web/src/pages/Settings/Settings'
import { useAgentStore } from '../../../web/src/store/agent'
import { useConversationsStore } from '../../../web/src/store/conversation'
import { createInitialState } from '../../../web/src/store/conversation/initialState'
import { useMessagesStore } from '../../../web/src/store/messages'

const mocks = vi.hoisted(() => ({
  agent: {
    approvePendingAction: vi.fn(async () => null),
    approvePendingActionWithWhitelist: vi.fn(async () => null),
    cancelTask: vi.fn(async () => null),
    listActiveTasks: vi.fn<() => Promise<AgentTaskSnapshot[]>>(async () => []),
    rejectPendingAction: vi.fn(async () => null),
    startTurn: vi.fn(),
  },
  chat: {
    getConversationById: vi.fn(),
    getMessagesByConvIdWithPagination: vi.fn(),
    getWorkspaceConversations: vi.fn(async () => ({ data: [], total: 0 })),
    initConversationsTitle: vi.fn(async () => ({ success: true, data: null })),
    updateConversation: vi.fn(),
  },
  generalSettings: {
    getSettings: vi.fn(async () => ({
      assistantModelId: '',
      proxySettings: {
        mode: 'system',
        customProxyUrl: '',
      },
    })),
    resetSettings: vi.fn(),
    updateSettings: vi.fn(),
  },
  provider: {
    getAllAbvailableModels: vi.fn(),
  },
  skill: {
    listSkills: vi.fn(async () => ({ skills: [] })),
  },
  workspace: {
    chooseWorkspace: vi.fn(async () => null),
    listWorkspaces: vi.fn(),
    openWorkspace: vi.fn(),
  },
}))

vi.mock('@/api/agentApi', () => ({
  default: mocks.agent,
}))

vi.mock('@/api/chatApi', () => ({
  default: mocks.chat,
}))

vi.mock('@/api/generalSettingsApi', () => ({
  generalSettingsApi: mocks.generalSettings,
}))

vi.mock('@/api/providerApi', () => ({
  providerApi: mocks.provider,
}))

vi.mock('@/api/skillApi', () => ({
  skillApi: mocks.skill,
}))

vi.mock('@/api/workspaceApi', () => ({
  default: mocks.workspace,
}))

vi.mock('@/components/Search', () => ({
  SearchContainer: () => null,
}))

const conversationsById = new Map<string, IConversations>()
const messagesByConversation = new Map<string, IMessage[]>()
const guiWorkspacePath = path.join(tmpdir(), 'ant-chat-gui-workspace')

describe('gui ui flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    conversationsById.clear()
    messagesByConversation.clear()

    window.matchMedia = vi.fn().mockImplementation(query => ({
      addEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      matches: false,
      media: query,
      onchange: null,
      removeEventListener: vi.fn(),
    }))
    Element.prototype.scrollIntoView = vi.fn()

    useMessagesStore.setState({
      activeConversationsId: '' as any,
      messageTotal: 1,
      messages: [],
      pageIndex: 0,
      pageSize: 6,
    })
    useConversationsStore.setState(createInitialState())
    useAgentStore.setState({ pendingByTask: {}, tasks: {} })

    mocks.provider.getAllAbvailableModels.mockResolvedValue([])
    mocks.skill.listSkills.mockResolvedValue({ skills: [] })
    mocks.workspace.listWorkspaces.mockResolvedValue({
      currentWorkspacePath: guiWorkspacePath,
      workspaces: [{
        path: guiWorkspacePath,
        displayName: 'ant-chat-gui-workspace',
        addedAt: 1,
        lastOpenedAt: 1,
      }],
    })
    mocks.chat.getMessagesByConvIdWithPagination.mockImplementation(async (id: string) => ({
      data: messagesByConversation.get(id) || [],
      total: messagesByConversation.get(id)?.length || 0,
    }))
    mocks.chat.getConversationById.mockImplementation(async (id: string) => conversationsById.get(id))
    mocks.chat.updateConversation.mockImplementation(async (conversation: Partial<IConversations> & { id: string }) => {
      const current = conversationsById.get(conversation.id) || createConversation(conversation.id)
      const next = { ...current, ...conversation }
      conversationsById.set(next.id, next)
      return next
    })
    mocks.agent.listActiveTasks.mockResolvedValue([])
    mocks.agent.startTurn.mockImplementation(async () => {
      const conversation = createConversation('conv-gui')
      conversationsById.set(conversation.id, conversation)
      messagesByConversation.set(conversation.id, [])
      return {
        taskId: 'task-gui',
        conversationId: conversation.id,
        userMessageId: 'user-gui',
        conversation,
      }
    })
  })

  it('opens the settings window from chat and keeps new chat available', async () => {
    vi.mocked(window.electron.ipcRenderer.invoke).mockResolvedValue({ success: true, data: null })
    renderGui('/')

    expect(await screen.findByTestId('chat-input')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('sidebar-settings'))
    await waitFor(() => {
      expect(window.electron.ipcRenderer.invoke).toHaveBeenCalled()
    })

    fireEvent.click(screen.getByTestId('sidebar-new-chat'))
    expect(await screen.findByTestId('chat-input')).toBeInTheDocument()
  })

  it('reserves top space for native window controls in settings navigation', async () => {
    renderSettingsWindow('/settings/general')

    expect(await screen.findByTestId('settings-nav-general')).toBeInTheDocument()
    expect(screen.getByTestId('settings-nav')).toHaveClass('pt-12')
  })

  it('未选择模型时发送消息会提示用户先选择模型', async () => {
    renderGui('/chat')

    fireEvent.change(await screen.findByTestId('chat-input'), {
      target: { value: 'hello' },
    })
    fireEvent.click(screen.getByTestId('chat-submit'))

    expect(await screen.findByText('请选择模型')).toBeInTheDocument()
    expect(mocks.agent.startTurn).not.toHaveBeenCalled()
  })

  it('agent 基础聊天闭环：提交后加载会话消息', async () => {
    mocks.provider.getAllAbvailableModels.mockResolvedValue([{
      id: 'provider-1',
      name: 'Provider',
      models: [{
        id: 'model-1',
        model: 'mock-model',
        name: 'Mock Model',
        serviceProviderId: 'provider-1',
        maxTokens: 1024,
        temperature: 0,
      }],
    }])
    mocks.agent.startTurn.mockImplementation(async () => {
      const conversation = createConversation('conv-agent')
      conversationsById.set(conversation.id, conversation)
      messagesByConversation.set(conversation.id, [
        createMessage({ id: 'user-1', convId: conversation.id, role: 'user', text: '检查当前目录' }),
        createMessage({ id: 'assistant-1', convId: conversation.id, role: 'assistant', text: '目录检查完成。' }),
      ])
      return {
        taskId: 'task-agent',
        conversationId: conversation.id,
        userMessageId: 'user-1',
        conversation,
      }
    })

    renderGui('/chat')
    await waitFor(() => expect(screen.getByText('Mock Model')).toBeInTheDocument())

    fireEvent.change(screen.getByTestId('chat-input'), {
      target: { value: '检查当前目录' },
    })
    fireEvent.click(screen.getByTestId('chat-submit'))

    await waitFor(() => {
      expect(mocks.agent.startTurn).toHaveBeenCalledWith(expect.objectContaining({
        chatSettings: expect.objectContaining({ modelId: 'model-1' }),
        prompt: '检查当前目录',
      }))
    })
    expect(await screen.findByText('目录检查完成。')).toBeInTheDocument()
  })

  it('agent 审批卡片支持批准和拒绝', async () => {
    seedActiveConversation('conv-approval')
    useAgentStore.setState({
      pendingByTask: {
        'task-approval': {
          actionId: 'action-1',
          createdAt: 1,
          inputPreview: '{"path":"file.txt"}',
          operationType: 'write',
          scope: 'workspace',
          toolName: 'write_file',
        },
      },
      tasks: {
        'task-approval': createTask({
          conversationId: 'conv-approval',
          status: 'awaiting_approval',
          taskId: 'task-approval',
        }),
      },
    })

    renderGui('/chat')

    expect(await screen.findByTestId('agent-approval-card')).toHaveTextContent('write_file')
    fireEvent.click(screen.getByTestId('agent-approve'))
    fireEvent.click(screen.getByTestId('agent-reject'))

    expect(mocks.agent.approvePendingActionWithWhitelist).toHaveBeenCalledWith({
      actionId: 'action-1',
      taskId: 'task-approval',
      remember: false,
      workspacePath: undefined,
    })
    expect(mocks.agent.rejectPendingAction).toHaveBeenCalledWith({
      actionId: 'action-1',
      reason: '用户拒绝',
      taskId: 'task-approval',
    })
  })

  it('运行中的 Agent task 可以从输入区取消', async () => {
    seedActiveConversation('conv-running')
    const task = createTask({
      conversationId: 'conv-running',
      status: 'running',
      taskId: 'task-running',
    })
    useAgentStore.setState({
      pendingByTask: {},
      tasks: { [task.taskId]: task },
    })
    useConversationsStore.setState({
      streamingConversationIds: new Set(['conv-running']),
    })
    mocks.agent.listActiveTasks.mockResolvedValue([task])

    renderGui('/chat')

    fireEvent.click(await screen.findByTestId('chat-cancel'))

    await waitFor(() => {
      expect(mocks.agent.listActiveTasks).toHaveBeenCalledWith('conv-running')
      expect(mocks.agent.cancelTask).toHaveBeenCalledWith('task-running')
    })
  })
})

function renderGui(initialPath: string) {
  const router = createMemoryRouter([
    {
      path: '/',
      Component: AppWrapper,
      children: [
        { index: true, element: <Navigate replace to="/chat" /> },
        { path: 'chat', Component: ChatPage },
        {
          path: 'settings',
          Component: SettingsPage,
          children: [
            { index: true, element: <Navigate replace to="./general" /> },
            { path: 'general', element: <div data-testid="settings-general-page">通用设置</div> },
          ],
        },
      ],
    },
  ], {
    initialEntries: [initialPath],
  })

  return render(<RouterProvider router={router} />)
}

function renderSettingsWindow(initialPath: string) {
  const router = createMemoryRouter([
    {
      path: '/',
      Component: SettingsPage,
      children: [
        { index: true, element: <Navigate replace to="./general" /> },
        { path: 'general', element: <div data-testid="settings-general-page">General settings</div> },
      ],
    },
    {
      path: '/settings',
      Component: SettingsPage,
      children: [
        { index: true, element: <Navigate replace to="./general" /> },
        { path: 'general', element: <div data-testid="settings-general-page">General settings</div> },
      ],
    },
  ], {
    initialEntries: [initialPath],
  })

  return render(<RouterProvider router={router} />)
}

function seedActiveConversation(conversationId: string) {
  const conversation = createConversation(conversationId)
  conversationsById.set(conversationId, conversation)
  messagesByConversation.set(conversationId, [])
  useMessagesStore.setState({
    activeConversationsId: conversationId as any,
    messages: [],
  })
  useConversationsStore.setState({
    activeConversationsId: conversationId,
    conversations: [conversation],
    currentWorkspacePath: guiWorkspacePath,
  })
}

function createConversation(id: string): IConversations {
  return {
    createdAt: Date.now(),
    id,
    settings: {
      compaction: {
        enabled: true,
        keepRecentPairs: 3,
        thresholdPercent: 70,
      },
      maxTokens: 1000,
      modelId: '',
      systemPrompt: '',
      temperature: 0.7,
    },
    title: 'GUI Conversation',
    updatedAt: Date.now(),
    workspacePath: guiWorkspacePath,
  } as IConversations
}

function createMessage(options: {
  convId: string
  id: string
  role: 'assistant' | 'user'
  text: string
}): IMessage {
  return {
    attachments: [],
    content: [{ text: options.text, type: 'text' }],
    convId: options.convId,
    createdAt: Date.now(),
    id: options.id,
    images: [],
    role: options.role,
    status: 'success',
    updatedAt: Date.now(),
  } as IMessage
}

function createTask(options: {
  conversationId: string
  status: AgentTaskSnapshot['status']
  taskId: string
}): AgentTaskSnapshot {
  const now = Date.now()
  return {
    conversationId: options.conversationId,
    createdAt: now,
    logPath: '',
    mode: 'hybrid',
    prompt: 'test',
    status: options.status,
    taskId: options.taskId,
    updatedAt: now,
    userMessageId: 'user-1',
    workspacePath: guiWorkspacePath,
  }
}
