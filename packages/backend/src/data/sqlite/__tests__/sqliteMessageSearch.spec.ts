import type { Database } from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAppDataMigrations, runSqliteMigrations } from '../migrations'
import { resolveSearchStrategy, SqliteMessageSearch } from '../sqliteMessageSearch'
import { SqliteConversationRepository } from '../repositories/sqliteConversationRepository'
import { SqliteMessageRepository } from '../repositories/sqliteMessageRepository'

const BetterSqlite = requireBetterSqlite()

describe('查询策略分类', () => {
  it('cJK ≥3 连续字符走 trigram，1–2 走 LIKE，其余走 unicode', () => {
    expect(resolveSearchStrategy(true, true, '搜索投影')).toBe('trigram')
    expect(resolveSearchStrategy(true, true, '缓存问题')).toBe('trigram')
    expect(resolveSearchStrategy(true, true, '缓存')).toBe('like')
    expect(resolveSearchStrategy(true, true, 'src/utils/pathPolicy.ts')).toBe('unicode')
    expect(resolveSearchStrategy(true, true, 'quick brown fox')).toBe('unicode')
    expect(resolveSearchStrategy(true, true, 'grep_*.ts')).toBe('unicode')
  })

  it('trigram 不可用时 CJK 长词显式降级为 LIKE', () => {
    expect(resolveSearchStrategy(true, false, '搜索投影')).toBe('like')
    expect(resolveSearchStrategy(false, false, 'quick brown')).toBe('like')
  })
})

describe('sqliteMessageSearch', () => {
  let sqlite: Database
  let attachmentsRoot: string
  let conversationRepository: SqliteConversationRepository
  let messageRepository: SqliteMessageRepository
  let search: SqliteMessageSearch

  beforeEach(() => {
    sqlite = new BetterSqlite(':memory:')
    attachmentsRoot = mkdtempSync(path.join(tmpdir(), 'ant-chat-search-attachments-'))
    runSqliteMigrations(sqlite, createAppDataMigrations({ attachmentsRootPath: attachmentsRoot }))
    conversationRepository = new SqliteConversationRepository(sqlite)
    messageRepository = new SqliteMessageRepository(sqlite, { attachmentsRoot })
    search = new SqliteMessageSearch(sqlite)
  })

  afterEach(() => {
    sqlite.close()
    rmSync(attachmentsRoot, { force: true, recursive: true })
  })

  async function createConversation(workspacePath: string, title: string) {
    return await conversationRepository.create({
      title,
      workspacePath,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      conversationInstructions: '',
      settings: { modelId: 'model-1', providerId: '' },
    })
  }

  async function addMessage(conversationId: string, content: Parameters<SqliteMessageRepository['create']>[0]['content'], options: { role?: 'user' | 'assistant' | 'tool' | 'event', status?: string, turnId?: string, eventType?: string, compactedThroughMessageId?: string, createdAt?: number } = {}) {
    const message = await messageRepository.create({
      convId: conversationId,
      role: options.role ?? 'user',
      status: options.status ?? 'success',
      content,
      turnId: options.turnId,
      eventType: options.eventType,
      compactedThroughMessageId: options.compactedThroughMessageId,
    } as never)
    return message
  }

  describe('search', () => {
    it('英文短语走 unicode61 FTS', async () => {
      const conversation = await createConversation('/workspace-a', '会话 A')
      const target = await addMessage(conversation.id, [{ type: 'text', text: 'the quick brown fox jumps over the lazy dog' }])
      await addMessage(conversation.id, [{ type: 'text', text: 'completely unrelated content here' }])

      const page = await search.search({ query: 'quick brown', workspacePath: '/workspace-a' })
      expect(page.hits).toHaveLength(1)
      expect(page.hits[0].messageId).toBe(target.id)
      expect(page.hits[0].conversationTitle).toBe('会话 A')
      expect(page.hits[0].ordinal).toBe(1)
    })

    it('标识符与路径走 unicode61（工具参数路径可检索）', async () => {
      const conversation = await createConversation('/workspace-a', '路径会话')
      await addMessage(conversation.id, [{ type: 'text', text: 'refactor src/utils/pathPolicy.ts to fix resolution' }])

      const page = await search.search({ query: 'src/utils/pathPolicy.ts', workspacePath: '/workspace-a' })
      expect(page.hits.map(hit => hit.messageId)).toHaveLength(1)
    })

    it('cJK 长词走 trigram 精确短语', async () => {
      const conversation = await createConversation('/workspace-a', '中文会话')
      const target = await addMessage(conversation.id, [{ type: 'text', text: '搜索投影与触发器设计' }])
      await addMessage(conversation.id, [{ type: 'text', text: '另一个搜索项但不是投影' }])

      const page = await search.search({ query: '搜索投影', workspacePath: '/workspace-a' })
      expect(page.hits.map(hit => hit.messageId)).toEqual([target.id])
    })

    it('cJK 短词（1–2 字）走 LIKE，且 % _ \ 按字面匹配', async () => {
      const conversation = await createConversation('/workspace-a', '字面量会话')
      const percent = await addMessage(conversation.id, [{ type: 'text', text: '本次优惠 100%_OFF 结束' }])
      const underscore = await addMessage(conversation.id, [{ type: 'text', text: '缓存目录 src/cache/xx' }])
      await addMessage(conversation.id, [{ type: 'text', text: '没有关键词的消息' }])

      const percentPage = await search.search({ query: '%_OFF', workspacePath: '/workspace-a' })
      expect(percentPage.hits.map(hit => hit.messageId)).toEqual([percent.id])

      const cachePage = await search.search({ query: '缓存', workspacePath: '/workspace-a' })
      expect(cachePage.hits.map(hit => hit.messageId)).toEqual([underscore.id])
    })

    it('tool 调用文本与参数可检索（search_messages 覆盖 agent 工具痕迹）', async () => {
      const conversation = await createConversation('/workspace-a', '工具会话')
      const call = await addMessage(conversation.id, [{
        type: 'tool-call',
        toolCallId: 'call-1',
        toolName: 'grep_files',
        args: { pattern: '**/specs/unique-args/*.test.ts', path: 'src' },
      }])
      const result = await addMessage(conversation.id, [{
        type: 'tool-result',
        toolCallId: 'call-1',
        toolName: 'grep_files',
        result: { matches: ['src/a.test.ts'] },
      }], { role: 'tool' })

      const byName = await search.search({ query: 'grep_files', workspacePath: '/workspace-a' })
      expect(byName.hits.map(hit => hit.messageId)).toEqual(expect.arrayContaining([call.id, result.id]))

      // 参数中的唯一 token 只出现在 tool-call 的 args JSON 里
      const byArgs = await search.search({ query: 'unique-args', workspacePath: '/workspace-a' })
      expect(byArgs.hits.map(hit => hit.messageId)).toEqual([call.id])
    })

    it('tool_name 精确过滤：只命中调过该工具的消息（call 与 result 均命中）', async () => {
      const conversation = await createConversation('/workspace-a', '工具过滤会话')
      // 文本消息在全文层命中 grep_files，但没有 tool fact，应被过滤掉
      await addMessage(conversation.id, [{ type: 'text', text: '先跑一下 grep_files 看看结果' }])
      const call = await addMessage(conversation.id, [{
        type: 'tool-call',
        toolCallId: 'call-1',
        toolName: 'grep_files',
        args: { pattern: '*.ts' },
      }])
      const result = await addMessage(conversation.id, [{
        type: 'tool-result',
        toolCallId: 'call-1',
        toolName: 'grep_files',
        result: { matches: [] },
      }], { role: 'tool' })
      await addMessage(conversation.id, [{
        type: 'tool-call',
        toolCallId: 'call-2',
        toolName: 'read_file',
        args: { path: '/a.ts' },
      }])

      const page = await search.search({ query: 'grep_files', workspacePath: '/workspace-a', toolName: 'grep_files' })
      expect(page.hits.map(hit => hit.messageId)).toEqual([call.id, result.id])
    })

    it('server_name 精确过滤：只命中经该 MCP server 调用的消息', async () => {
      const conversation = await createConversation('/workspace-a', 'server 过滤会话')
      const mcpCall = await addMessage(conversation.id, [{
        type: 'tool-call',
        toolCallId: 'call-1',
        toolName: 'slack_post',
        serverName: 'slack',
        args: { text: 'hello' },
      }])
      await addMessage(conversation.id, [{
        type: 'tool-call',
        toolCallId: 'call-2',
        toolName: 'slack_post',
        args: { text: 'hello' },
      }])

      const byServer = await search.search({ query: 'hello', workspacePath: '/workspace-a', serverName: 'slack' })
      expect(byServer.hits.map(hit => hit.messageId)).toEqual([mcpCall.id])

      // tool_name + server_name 组合：二者都须匹配
      const combined = await search.search({ query: 'hello', workspacePath: '/workspace-a', toolName: 'slack_post', serverName: 'slack' })
      expect(combined.hits.map(hit => hit.messageId)).toEqual([mcpCall.id])
      expect((await search.search({ query: 'hello', workspacePath: '/workspace-a', toolName: 'read_file', serverName: 'slack' })).hits).toHaveLength(0)
    })

    it('event 消息（compaction 摘要）不参与搜索', async () => {
      const conversation = await createConversation('/workspace-a', '压缩会话')
      await addMessage(conversation.id, [{ type: 'text', text: '被压缩的原始证据' }])
      await addMessage(conversation.id, [{ type: 'text', text: '压缩摘要内容' }], {
        role: 'event',
        status: 'success',
        eventType: 'compaction',
        compactedThroughMessageId: 'whatever',
      })

      const page = await search.search({ query: '压缩摘要', workspacePath: '/workspace-a' })
      expect(page.hits).toHaveLength(0)
    })

    it('workspace 过滤：workspace A 的会话不会出现在 workspace B 的搜索结果', async () => {
      const conversationA = await createConversation('/workspace-a', 'A')
      const conversationB = await createConversation('/workspace-b', 'B')
      const messageA = await addMessage(conversationA.id, [{ type: 'text', text: 'secret-project-alpha' }])
      await addMessage(conversationB.id, [{ type: 'text', text: 'secret-project-alpha' }])

      const pageA = await search.search({ query: 'secret-project-alpha', workspacePath: '/workspace-a' })
      expect(pageA.hits.map(hit => hit.messageId)).toEqual([messageA.id])
    })

    it('conversationId 过滤限定单个会话', async () => {
      const conversationA = await createConversation('/workspace-a', 'A')
      const conversationB = await createConversation('/workspace-a', 'B')
      await addMessage(conversationA.id, [{ type: 'text', text: 'shared-token-xyz' }])
      const messageB = await addMessage(conversationB.id, [{ type: 'text', text: 'shared-token-xyz' }])

      const page = await search.search({ query: 'shared-token-xyz', workspacePath: '/workspace-a', conversationId: conversationB.id })
      expect(page.hits.map(hit => hit.messageId)).toEqual([messageB.id])
    })

    it('cursor keyset 翻页稳定', async () => {
      const conversation = await createConversation('/workspace-a', '翻页会话')
      const ids: string[] = []
      for (let i = 0; i < 25; i++) {
        const message = await addMessage(conversation.id, [{ type: 'text', text: `paged-token-${i}` }])
        ids.push(message.id)
      }

      const first = await search.search({ query: 'paged-token', workspacePath: '/workspace-a', limit: 10 })
      expect(first.hits).toHaveLength(10)
      expect(first.cursor).toBeDefined()

      const second = await search.search({ query: 'paged-token', workspacePath: '/workspace-a', limit: 10, cursor: first.cursor })
      expect(second.hits).toHaveLength(10)
      const secondIds = new Set(second.hits.map(hit => hit.messageId))
      expect(first.hits.some(hit => secondIds.has(hit.messageId))).toBe(false)

      const third = await search.search({ query: 'paged-token', workspacePath: '/workspace-a', limit: 10, cursor: second.cursor })
      expect(third.hits).toHaveLength(5)
      expect(third.cursor).toBeUndefined()
    })

    it('contextRadius 展开命中消息的相邻窗口（不含其他命中）', async () => {
      const conversation = await createConversation('/workspace-a', '上下文会话')
      const before = await addMessage(conversation.id, [{ type: 'text', text: 'before context' }])
      const hit = await addMessage(conversation.id, [{ type: 'text', text: 'context-token-target' }])
      const after = await addMessage(conversation.id, [{ type: 'text', text: 'after context' }])

      const page = await search.search({ query: 'context-token-target', workspacePath: '/workspace-a', contextRadius: 1 })
      expect(page.hits).toHaveLength(1)
      expect(page.hits[0].context?.map(message => message.messageId)).toEqual([before.id, after.id])
      expect(page.hits[0].context?.some(message => message.messageId === hit.id)).toBe(false)
    })
  })

  describe('getThread', () => {
    it('无 cursor 时锚定最后一条消息，返回 before 窗口并按 ordinal 升序', async () => {
      const conversation = await createConversation('/workspace-a', '线程会话')
      const ids: string[] = []
      for (let i = 1; i <= 5; i++) {
        const message = await addMessage(conversation.id, [{ type: 'text', text: `msg-${i}` }])
        ids.push(message.id)
      }

      const page = await search.getThread({ conversationId: conversation.id, before: 3 })
      expect(page.anchorOrdinal).toBe(5)
      expect(page.messages.map(message => message.ordinal)).toEqual([2, 3, 4])
      expect(page.messages.map(message => message.messageId)).toEqual(ids.slice(1, 4))
      expect(page.cursor).toEqual({ ordinal: 2 })
    })

    it('cursor 向前翻页直到窗口头', async () => {
      const conversation = await createConversation('/workspace-a', '翻页线程')
      const ids: string[] = []
      for (let i = 1; i <= 5; i++) {
        const message = await addMessage(conversation.id, [{ type: 'text', text: `msg-${i}` }])
        ids.push(message.id)
      }

      const first = await search.getThread({ conversationId: conversation.id, before: 3 })
      const second = await search.getThread({ conversationId: conversation.id, before: 3, cursor: first.cursor })
      expect(second.messages.map(message => message.ordinal)).toEqual([1])
      expect(second.anchorOrdinal).toBe(2)
      expect(second.cursor).toEqual({ ordinal: 1 })
    })

    it('before+after 同时给出锚点两侧窗口', async () => {
      const conversation = await createConversation('/workspace-a', '双侧线程')
      const ids: string[] = []
      for (let i = 1; i <= 5; i++) {
        const message = await addMessage(conversation.id, [{ type: 'text', text: `msg-${i}` }])
        ids.push(message.id)
      }

      const page = await search.getThread({ conversationId: conversation.id, before: 2, after: 2, cursor: { ordinal: 3 } })
      expect(page.messages.map(message => message.ordinal)).toEqual([1, 2, 4, 5])
      expect(page.anchorOrdinal).toBe(3)
    })

    it('不存在的会话返回空页', async () => {
      const page = await search.getThread({ conversationId: 'conv-missing' })
      expect(page.messages).toEqual([])
    })
  })

  describe('getTurn', () => {
    it('返回用户根消息 + 同 turn 消息，按 ordinal 排序', async () => {
      const conversation = await createConversation('/workspace-a', 'turn 会话')
      const userMessage = await addMessage(conversation.id, [{ type: 'text', text: '帮我查一下配置' }])
      const turnId = userMessage.id
      const assistant = await addMessage(conversation.id, [{ type: 'text', text: '好的，正在查询' }], { role: 'assistant', turnId })
      const toolMessage = await addMessage(conversation.id, [{ type: 'tool-result', toolCallId: 'c1', toolName: 'read_file', result: 'ok' }], { role: 'tool', turnId })

      const turn = await search.getTurn({ messageId: toolMessage.id })
      expect(turn.turnId).toBe(turnId)
      expect(turn.userMessage?.messageId).toBe(userMessage.id)
      expect(turn.messages.map(message => message.messageId)).toEqual([userMessage.id, assistant.id, toolMessage.id])
    })

    it('无 turn_id 的消息退化为单条消息', async () => {
      const conversation = await createConversation('/workspace-a', '无 turn 会话')
      const message = await addMessage(conversation.id, [{ type: 'text', text: '孤立的旧消息' }])

      const turn = await search.getTurn({ messageId: message.id })
      expect(turn.turnId).toBeUndefined()
      expect(turn.userMessage).toBeUndefined()
      expect(turn.messages.map(item => item.messageId)).toEqual([message.id])
    })

    it('返回关联的 compaction boundary（ordinal 在 turn 之前的最近压缩事件）', async () => {
      const conversation = await createConversation('/workspace-a', '压缩 turn 会话')
      await addMessage(conversation.id, [{ type: 'text', text: '老消息 1' }])
      await addMessage(conversation.id, [{ type: 'text', text: '老消息 2' }])
      const compactedThrough = await addMessage(conversation.id, [{ type: 'text', text: '被压缩的最后一条' }])
      const boundary = await addMessage(conversation.id, [{ type: 'text', text: '前面 X 条已压缩为摘要' }], {
        role: 'event',
        eventType: 'compaction',
        compactedThroughMessageId: compactedThrough.id,
      })
      const userMessage = await addMessage(conversation.id, [{ type: 'text', text: '压缩后的新问题' }])
      const assistant = await addMessage(conversation.id, [{ type: 'text', text: '新回答' }], { role: 'assistant', turnId: userMessage.id })

      const turn = await search.getTurn({ messageId: assistant.id })
      expect(turn.compactionBoundary).toEqual(expect.objectContaining({
        messageId: boundary.id,
        compactedThroughMessageId: compactedThrough.id,
        summaryText: '前面 X 条已压缩为摘要',
      }))
      expect(turn.messages.map(message => message.messageId)).toEqual([userMessage.id, assistant.id])
    })

    it('不存在的消息抛出错误', async () => {
      await expect(search.getTurn({ messageId: 'msg-missing' })).rejects.toThrow('消息未找到')
    })
  })
})

function requireBetterSqlite(): new (filename: string) => Database {
  const require = createRequire(import.meta.url)
  return require('better-sqlite3') as new (filename: string) => Database
}
