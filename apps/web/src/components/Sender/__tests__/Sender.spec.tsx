import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TooltipProvider } from '@workspace/ui/components/tooltip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatSettingsContext, DEFAULT_SETTINGS } from '@/contexts/chatSettings'
import { useChatSttingsStore } from '@/store/chatSettings'
import { useConversationsStore } from '@/store/conversation'
import { useMessagesStore } from '@/store/messages'
import Sender from '../Sender'

const mocks = vi.hoisted(() => ({
  searchWorkspaceFiles: vi.fn(),
}))

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.mock('@/api/workspaceApi', () => ({
  default: {
    listWorkspaces: vi.fn(async () => ({
      currentWorkspacePath: '/tmp/workspace',
      workspaces: [
        { path: '/tmp/workspace', displayName: 'workspace' },
      ],
    })),
    openWorkspace: vi.fn(),
    searchWorkspaceFiles: mocks.searchWorkspaceFiles,
  },
}))

vi.mock('@/api/skillApi', () => ({
  skillApi: {
    listSkills: vi.fn(async () => ({ skills: [] })),
  },
}))

vi.mock('@/api/providerApi', () => ({
  providerApi: {
    getModelInfoById: vi.fn(async () => ({
      id: 'test-model',
      model: 'test-model',
      name: 'Test Model',
      providerId: 'test-provider',
      isBuiltin: false,
      isEnabled: true,
      maxTokens: 4096,
      contextLength: 4096,
      temperature: 0.7,
      capabilities: {
        functionCall: true,
        reasoning: true,
        inputModalities: ['text', 'image', 'pdf'],
      },
      createdAt: 0,
    })),
  },
}))

function renderSender(onSubmit = vi.fn()) {
  render(
    <TooltipProvider>
      <ChatSettingsContext
        value={{
          settings: { ...DEFAULT_SETTINGS, modelId: 'test-model' },
          updateSettings: vi.fn(),
        }}
      >
        <Sender onSubmit={onSubmit} />
      </ChatSettingsContext>
    </TooltipProvider>,
  )

  return onSubmit
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  fireEvent.change(textarea, {
    target: {
      value,
      selectionStart: value.length,
      selectionEnd: value.length,
    },
  })
}

describe('sender reference token overlay', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
    Element.prototype.scrollIntoView = vi.fn()
    mocks.searchWorkspaceFiles.mockResolvedValue([
      { path: 'resume.md', name: 'resume.md', type: 'file' },
    ])
    useMessagesStore.setState({
      activeConversationsId: '',
      messages: [],
    })
    useConversationsStore.setState({
      activeConversationsId: '',
      conversations: [],
      abortCallbacks: [],
      pageIndex: 0,
      pageSize: 20,
      conversationsTotal: 1,
      streamingConversationIds: new Set<string>(),
      loadVersion: 0,
      currentWorkspacePath: '/tmp/workspace',
      workspaceConversations: {},
    })
    useChatSttingsStore.setState({
      enableMCP: false,
      agentMode: 'hybrid',
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('手动输入未确认引用时不渲染 token', async () => {
    renderSender()
    await screen.findByText('workspace')

    const textarea = screen.getByTestId('chat-input') as HTMLTextAreaElement
    setTextareaValue(textarea, '看 @resume.md')

    expect(screen.queryByTestId('reference-token')).toBeNull()
    expect(textarea.value).toBe('看 @resume.md')
  })

  it('选择文件引用后渲染 overlay token，提交后清空', async () => {
    const onSubmit = renderSender()
    await screen.findByText('workspace')
    const textarea = screen.getByTestId('chat-input') as HTMLTextAreaElement

    setTextareaValue(textarea, '看 @res')

    await waitFor(() => {
      expect(mocks.searchWorkspaceFiles).toHaveBeenCalledWith('res', 50)
    })

    fireEvent.mouseDown(await screen.findByText('resume.md'))

    await waitFor(() => {
      expect(textarea.value).toBe('看 @resume.md ')
    })
    expect(screen.getByTestId('reference-token').textContent).toBe('@resume.md')

    fireEvent.click(screen.getByTestId('chat-submit'))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        [{ type: 'text', text: '看 @resume.md ' }],
        ['resume.md'],
        undefined,
        { enableMCP: false },
        'hybrid',
      )
    })
    await waitFor(() => {
      expect(textarea.value).toBe('')
    })
    expect(screen.queryByTestId('reference-token')).toBeNull()
  })
})
