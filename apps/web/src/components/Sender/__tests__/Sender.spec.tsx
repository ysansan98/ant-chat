import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TooltipProvider } from '@workspace/ui/components/tooltip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatSettingsContext, DEFAULT_SETTINGS } from '@/contexts/chatSettings'
import { useChatSttingsStore } from '@/store/chatSettings'
import { useConversationsStore } from '@/store/conversation'
import { useMessagesStore } from '@/store/messages'
import { useWorkspaceStore } from '@/store/workspace'
import Sender from '../Sender'

const mocks = vi.hoisted(() => ({
  searchWorkspaceFiles: vi.fn(),
  listWorkspaces: vi.fn(),
}))

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.mock('@/api/workspaceApi', () => ({
  default: {
    listWorkspaces: mocks.listWorkspaces,
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
      contextLength: 128_000,
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
          settings: { ...DEFAULT_SETTINGS, modelId: 'test-model', providerId: 'test-provider' },
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
    mocks.listWorkspaces.mockResolvedValue({
      workspaces: [
        { path: '/tmp/workspace', displayName: 'workspace' },
      ],
    })
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
      conversationStates: {},
      loadVersion: 0,
      workspaceConversations: {},
    })
    useWorkspaceStore.setState({ currentWorkspacePath: '/tmp/workspace', workspaceData: null, loading: false })
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

  it('使用模型上下文长度计算上下文占用', async () => {
    renderSender()
    await screen.findByText('workspace')

    const usageIcon = screen.getByRole('img', { name: 'Model context usage' })
    const trigger = usageIcon.closest('button')
    expect(trigger).not.toBeNull()

    fireEvent.pointerEnter(trigger as HTMLButtonElement)

    expect(await screen.findByText('0 / 128K')).toBeInTheDocument()
  })

  it('选择文件引用后渲染 overlay token，提交后清空', async () => {
    const onSubmit = renderSender()
    await screen.findByText('workspace')
    const textarea = screen.getByTestId('chat-input') as HTMLTextAreaElement

    setTextareaValue(textarea, '看 @res')

    await waitFor(() => {
      expect(mocks.searchWorkspaceFiles).toHaveBeenCalledWith('/tmp/workspace', 'res', 50)
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

  it('点选目录补全路径并下钻到子目录', async () => {
    mocks.searchWorkspaceFiles.mockImplementation((_ws, query) => {
      if (query === 'd') {
        return Promise.resolve([
          { path: 'docs', name: 'docs', type: 'directory' },
          { path: 'a.ts', name: 'a.ts', type: 'file' },
        ])
      }
      if (query === 'docs/') {
        return Promise.resolve([
          { path: 'docs/guide.md', name: 'guide.md', type: 'file' },
        ])
      }
      return Promise.resolve([])
    })

    renderSender()
    await screen.findByText('workspace')
    const textarea = screen.getByTestId('chat-input') as HTMLTextAreaElement

    setTextareaValue(textarea, '@d')

    await waitFor(() => {
      expect(mocks.searchWorkspaceFiles).toHaveBeenCalledWith('/tmp/workspace', 'd', 50)
    })

    // 目录项点击后把目录路径补到 @ 之后（带尾斜杠），不关闭面板
    fireEvent.mouseDown(await screen.findByText('docs'))

    await waitFor(() => {
      expect(textarea.value).toBe('@docs/')
    })

    // 下钻后应继续搜索 docs/ 下的内容
    await waitFor(() => {
      expect(mocks.searchWorkspaceFiles).toHaveBeenCalledWith('/tmp/workspace', 'docs/', 50)
    })
    // 子目录下的文件出现在面板
    expect(await screen.findByText('docs/guide.md')).toBeInTheDocument()
  })

  it('钻取后点 .. 返回上级目录', async () => {
    mocks.searchWorkspaceFiles.mockImplementation((_ws, query) => {
      if (query === 'd') {
        return Promise.resolve([{ path: 'docs', name: 'docs', type: 'directory' }])
      }
      if (query === 'docs/') {
        return Promise.resolve([{ path: 'docs/guide.md', name: 'guide.md', type: 'file' }])
      }
      return Promise.resolve([])
    })

    renderSender()
    await screen.findByText('workspace')
    const textarea = screen.getByTestId('chat-input') as HTMLTextAreaElement

    setTextareaValue(textarea, '@d')
    fireEvent.mouseDown(await screen.findByText('docs'))
    await waitFor(() => expect(textarea.value).toBe('@docs/'))

    // 钻取态面板顶部出现 ..
    fireEvent.mouseDown(await screen.findByText('..', { exact: true }))

    await waitFor(() => {
      expect(textarea.value).toBe('@')
    })
  })

  it('目录项排在文件项之前', async () => {
    mocks.searchWorkspaceFiles.mockResolvedValue([
      { path: 'docs', name: 'docs', type: 'directory' },
      { path: 'a.ts', name: 'a.ts', type: 'file' },
    ])

    renderSender()
    await screen.findByText('workspace')
    const textarea = screen.getByTestId('chat-input') as HTMLTextAreaElement

    setTextareaValue(textarea, '@d')

    const docsItem = await screen.findByText('docs')
    const aTsItem = await screen.findByText('a.ts')

    // docs 在 DOM 中先于 a.ts
    expect(
      docsItem.compareDocumentPosition(aTsItem) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('按 Enter 选中高亮目录项下钻', async () => {
    mocks.searchWorkspaceFiles.mockImplementation((_ws, query) => {
      if (query === 'd') {
        return Promise.resolve([{ path: 'docs', name: 'docs', type: 'directory' }])
      }
      if (query === 'docs/') {
        return Promise.resolve([{ path: 'docs/guide.md', name: 'guide.md', type: 'file' }])
      }
      return Promise.resolve([])
    })

    renderSender()
    await screen.findByText('workspace')
    const textarea = screen.getByTestId('chat-input') as HTMLTextAreaElement

    setTextareaValue(textarea, '@d')
    await screen.findByText('docs')

    // 非钻取态高亮首项是目录 docs，Enter 下钻
    fireEvent.keyDown(textarea, { key: 'Enter' })

    await waitFor(() => {
      expect(textarea.value).toBe('@docs/')
    })
  })

  it('鼠标悬停时同步高亮索引，避免与键盘高亮并存', async () => {
    mocks.searchWorkspaceFiles.mockResolvedValue([
      { path: 'docs', name: 'docs', type: 'directory' },
      { path: 'a.ts', name: 'a.ts', type: 'file' },
      { path: 'b.ts', name: 'b.ts', type: 'file' },
    ])

    renderSender()
    await screen.findByText('workspace')
    const textarea = screen.getByTestId('chat-input') as HTMLTextAreaElement

    setTextareaValue(textarea, '@d')

    const docsItem = await screen.findByText('docs')
    const aTsItem = await screen.findByText('a.ts')
    const bTsItem = await screen.findByText('b.ts')

    // 初始高亮在首项 docs
    expect(docsItem.closest('[data-highlighted="true"]')).not.toBeNull()

    // 键盘下移到 a.ts
    fireEvent.keyDown(textarea, { key: 'ArrowDown' })
    await waitFor(() => {
      expect(aTsItem.closest('[data-highlighted="true"]')).not.toBeNull()
      expect(docsItem.closest('[data-highlighted="true"]')).toBeNull()
    })

    // 鼠标悬停到 b.ts 时，高亮应同步到 b.ts，a.ts 取消高亮
    fireEvent.mouseEnter(bTsItem)
    await waitFor(() => {
      expect(bTsItem.closest('[data-highlighted="true"]')).not.toBeNull()
      expect(aTsItem.closest('[data-highlighted="true"]')).toBeNull()
    })
  })
})
