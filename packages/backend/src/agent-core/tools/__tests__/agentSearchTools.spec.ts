import type { MemoryCatalogPort, MemoryProposal, MessageSearchPage, MessageSearchPort } from '@ant-chat/shared'
import { describe, expect, it, vi } from 'vitest'
import { createMemoryCatalogTools } from '../memoryCatalogTools'
import { createMessageSearchTools } from '../messageSearchTools'

describe('createMessageSearchTools', () => {
  const workspacePath = '/workspace/a'

  function makeHit(messageId: string): MessageSearchPage['hits'][number] {
    return {
      messageId,
      conversationId: 'c-1',
      conversationTitle: '会话',
      ordinal: 1,
      role: 'user',
      status: 'success',
      text: '',
      toolText: '',
      createdAt: 1,
    }
  }

  function createSearchMock(): MessageSearchPort {
    return {
      search: vi.fn<MessageSearchPort['search']>(async () => ({
        hits: [makeHit('m-1')],
        cursor: { updatedAt: 1, conversationId: 'c-1', ordinal: 5 },
      })),
      getThread: vi.fn<MessageSearchPort['getThread']>(async () => ({
        messages: [makeHit('m-2')],
        anchorOrdinal: 5,
        cursor: { ordinal: 3 },
      })),
      getTurn: vi.fn<MessageSearchPort['getTurn']>(async () => ({
        turnId: 't-1',
        messages: [makeHit('m-3')],
      })),
    }
  }

  function findTool(tools: ReturnType<typeof createMessageSearchTools>, name: string) {
    const tool = tools.find(item => item.name === name)
    expect(tool).toBeDefined()
    return tool!
  }

  it('search_messages 把工作区路径与查询参数传给后端', async () => {
    const search = createSearchMock()
    const tools = createMessageSearchTools(search, workspacePath)
    const tool = findTool(tools, 'search_messages')

    expect(tool.operationType).toBe('read')
    const result = await tool.execute({ query: '缓存', conversation_id: 'c-9', limit: 3, context_radius: 2, tool_name: 'grep_files', server_name: 'ant-chat' })
    expect(result.ok).toBe(true)
    expect(search.search).toHaveBeenCalledWith({
      query: '缓存',
      workspacePath,
      conversationId: 'c-9',
      limit: 3,
      contextRadius: 2,
      cursor: undefined,
      toolName: 'grep_files',
      serverName: 'ant-chat',
    })
    expect(JSON.parse(result.result)).toMatchObject({ hits: [{ messageId: 'm-1' }] })
  })

  it('search_messages 拒绝非法输入', async () => {
    const tool = findTool(createMessageSearchTools(createSearchMock(), workspacePath), 'search_messages')
    expect(tool.validateInput?.({ query: '' })).toContain('query')
    expect(tool.validateInput?.({ query: 'x', limit: 999 })).toContain('limit')
    expect(tool.validateInput?.({ query: 'x', context_radius: -1 })).toContain('context_radius')
    expect(tool.validateInput?.({ query: 'x', cursor: { ordinal: 1 } })).toContain('cursor')
    expect(tool.validateInput?.({ query: 'x', tool_name: '' })).toContain('tool_name')
    expect(tool.validateInput?.({ query: 'x', server_name: '  ' })).toContain('server_name')
    expect(tool.validateInput?.({ query: 'x' })).toBeNull()
  })

  it('get_thread 与 get_turn 调用对应后端方法', async () => {
    const search = createSearchMock()
    const tools = createMessageSearchTools(search, workspacePath)

    const threadTool = findTool(tools, 'get_thread')
    const threadResult = await threadTool.execute({ conversation_id: 'c-1', before: 5, cursor: { ordinal: 9 } })
    expect(threadResult.ok).toBe(true)
    expect(search.getThread).toHaveBeenCalledWith({ conversationId: 'c-1', before: 5, after: undefined, cursor: { ordinal: 9 } })

    const turnTool = findTool(tools, 'get_turn')
    const turnResult = await turnTool.execute({ message_id: 'm-3' })
    expect(turnResult.ok).toBe(true)
    expect(search.getTurn).toHaveBeenCalledWith({ messageId: 'm-3' })
    expect(JSON.parse(turnResult.result).turnId).toBe('t-1')
  })

  it('get_turn 消息缺失时返回失败结果而非抛异常', async () => {
    const search = createSearchMock()
    vi.mocked(search.getTurn).mockRejectedValue(new Error('消息未找到'))
    const tool = findTool(createMessageSearchTools(search, workspacePath), 'get_turn')
    const result = await tool.execute({ message_id: 'missing' })
    expect(result.ok).toBe(false)
    expect(result.result).toContain('消息未找到')
  })
})

describe('createMemoryCatalogTools', () => {
  const workspacePath = '/workspace/a'

  function createCatalogMock(): MemoryCatalogPort {
    return {
      search: vi.fn<MemoryCatalogPort['search']>(async () => []),
      propose: vi.fn<MemoryCatalogPort['propose']>(async (input: MemoryProposal) => ({
        id: 'mem-1',
        workspaceKey: 'key',
        workspacePath: input.workspacePath,
        title: input.title,
        summary: input.summary,
        bodyPath: '',
        bodySha256: '',
        status: 'pending',
        createdAt: 1,
      })),
      approve: vi.fn<MemoryCatalogPort['approve']>(),
      archive: vi.fn<MemoryCatalogPort['archive']>(),
    }
  }

  function findTool(tools: ReturnType<typeof createMemoryCatalogTools>, name: string) {
    const tool = tools.find(item => item.name === name)
    expect(tool).toBeDefined()
    return tool!
  }

  it('search_memories 只读并限定当前工作区', async () => {
    const catalog = createCatalogMock()
    const tool = findTool(createMemoryCatalogTools(catalog, { workspacePath }), 'search_memories')
    expect(tool.operationType).toBe('read')

    const result = await tool.execute({ query: '约定', limit: 5 })
    expect(result.ok).toBe(true)
    expect(catalog.search).toHaveBeenCalledWith({ query: '约定', workspacePath, limit: 5 })
  })

  it('propose_memory 在交互式 turn 创建 pending 记忆', async () => {
    const catalog = createCatalogMock()
    const tool = findTool(createMemoryCatalogTools(catalog, { workspacePath, turnSource: { type: 'interactive' } }), 'propose_memory')
    expect(tool.operationType).toBe('write')

    const result = await tool.execute({
      title: '项目约定',
      summary: '部署前运行检查',
      body: '详细正文',
      evidence_message_ids: ['m-1', 'm-2'],
    })
    expect(result.ok).toBe(true)
    expect(catalog.propose).toHaveBeenCalledWith({
      workspacePath,
      title: '项目约定',
      summary: '部署前运行检查',
      body: '详细正文',
      evidenceMessageIds: ['m-1', 'm-2'],
    })
    expect(JSON.parse(result.result).status).toBe('pending')
  })

  it('propose_memory 在自动化 turn 直接拒绝，不创建记录', async () => {
    const catalog = createCatalogMock()
    const tool = findTool(createMemoryCatalogTools(catalog, {
      workspacePath,
      turnSource: {
        type: 'automation',
        automationId: 'auto-1',
        runId: 'run-1',
        allowedSkills: [],
        allowedMcpServers: [],
        permissionPolicy: {
          workspaceAccess: 'read',
          allowBrowser: false,
          allowMcpTools: false,
          extraFileRoots: [],
          allowSelectedSkillRuntime: false,
          allowCommandExecution: false,
          commandPatterns: [],
        },
      },
    }), 'propose_memory')

    const result = await tool.execute({
      title: 'x',
      summary: 'y',
      body: 'z',
      evidence_message_ids: ['m-1'],
    })
    expect(result.ok).toBe(false)
    expect(result.result).toContain('自动化')
    expect(catalog.propose).not.toHaveBeenCalled()
  })

  it('propose_memory 校验必填字段', async () => {
    const catalog = createCatalogMock()
    const tool = findTool(createMemoryCatalogTools(catalog, { workspacePath }), 'propose_memory')
    expect(tool.validateInput?.({ title: 'x' })).toContain('summary')
    expect(tool.validateInput?.({ title: 'x', summary: 'y', body: 'z', evidence_message_ids: [] })).toContain('evidence')
    expect(tool.validateInput?.({ title: 'x', summary: 'y', body: 'z', evidence_message_ids: ['m-1'] })).toBeNull()
  })
})
