import type { AgentTool, MessageCursor, MessageSearchCursor, MessageSearchPort } from '@ant-chat/shared'

/**
 * Agent 专用消息搜索工具（只读）：search_messages / get_thread / get_turn。
 * 后端直接实现，不复用 renderer 的 search.searchByKeyword RPC。
 */

const SEARCH_MAX_LIMIT = 50
const SEARCH_MAX_RADIUS = 10
const THREAD_MAX_WINDOW = 100

export function createMessageSearchTools(search: MessageSearchPort, workspacePath: string): AgentTool[] {
  return [
    createSearchMessagesTool(search, workspacePath),
    createGetThreadTool(search),
    createGetTurnTool(search),
  ]
}

function createSearchMessagesTool(search: MessageSearchPort, workspacePath: string): AgentTool {
  return {
    name: 'search_messages',
    source: 'skill',
    serverName: 'agent-loop',
    description: [
      '搜索当前工作区会话历史中的消息（证据真相源）。',
      '支持英文、路径、标识符与中文短语；中文短词（1-2 字）自动走模糊匹配。',
      '返回命中消息的 message_id / conversation_id / ordinal / 文本与工具调用文本。',
      '可用 tool_name / server_name 精确过滤调过指定工具的消息（来自结构化 tool 事实）。',
      '用 context_radius 展开命中消息在会话中的上下文窗口；用 cursor 翻页。',
      '验证结论前用 get_turn 或 get_thread 深入查看完整上下文。',
    ].join('\n'),
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词（必填）。' },
        conversation_id: { type: 'string', description: '可选：限定单个会话。' },
        tool_name: { type: 'string', description: '可选：只返回调用过该工具的消息（call/result 均命中，精确匹配）。' },
        server_name: { type: 'string', description: '可选：只返回经该 MCP server 调用工具的消息（与 tool_name 组合时二者都须匹配）。' },
        limit: { type: 'number', description: `返回条数上限（默认 10，最大 ${SEARCH_MAX_LIMIT}）。` },
        context_radius: { type: 'number', description: `每条命中前后各展开的上下文消息数（默认 0，最大 ${SEARCH_MAX_RADIUS}）。` },
        cursor: {
          type: 'object',
          description: '可选：上一页返回的 cursor，原样传入继续翻页。',
          properties: {
            updatedAt: { type: 'number' },
            conversationId: { type: 'string' },
            ordinal: { type: 'number' },
          },
          required: ['updatedAt', 'conversationId', 'ordinal'],
        },
      },
      required: ['query'],
    },
    operationType: 'read',
    inferScope: () => 'workspace',
    validateInput: (input) => {
      if (typeof input.query !== 'string' || !input.query.trim()) {
        return 'query must be a non-empty string'
      }
      if (input.conversation_id !== undefined && (typeof input.conversation_id !== 'string' || !input.conversation_id.trim())) {
        return 'conversation_id must be a non-empty string'
      }
      if (input.tool_name !== undefined && (typeof input.tool_name !== 'string' || !input.tool_name.trim())) {
        return 'tool_name must be a non-empty string'
      }
      if (input.server_name !== undefined && (typeof input.server_name !== 'string' || !input.server_name.trim())) {
        return 'server_name must be a non-empty string'
      }
      if (input.limit !== undefined && !isIntInRange(input.limit, 1, SEARCH_MAX_LIMIT)) {
        return `limit must be an integer between 1 and ${SEARCH_MAX_LIMIT}`
      }
      if (input.context_radius !== undefined && !isIntInRange(input.context_radius, 0, SEARCH_MAX_RADIUS)) {
        return `context_radius must be an integer between 0 and ${SEARCH_MAX_RADIUS}`
      }
      if (input.cursor !== undefined && !isSearchCursor(input.cursor)) {
        return 'cursor must be a valid search cursor object'
      }
      return null
    },
    execute: async (input) => {
      const page = await search.search({
        query: String(input.query),
        workspacePath,
        conversationId: typeof input.conversation_id === 'string' ? input.conversation_id : undefined,
        toolName: typeof input.tool_name === 'string' ? input.tool_name : undefined,
        serverName: typeof input.server_name === 'string' ? input.server_name : undefined,
        limit: typeof input.limit === 'number' ? input.limit : undefined,
        contextRadius: typeof input.context_radius === 'number' ? input.context_radius : undefined,
        cursor: isSearchCursor(input.cursor) ? input.cursor : undefined,
      })
      return { ok: true, result: JSON.stringify(page) }
    },
  }
}

function createGetThreadTool(search: MessageSearchPort): AgentTool {
  return {
    name: 'get_thread',
    source: 'skill',
    serverName: 'agent-loop',
    description: [
      '按 ordinal 读取会话消息窗口（只读，不含压缩事件消息）。',
      'cursor 缺省时锚定会话最后一条消息；返回窗口最早一条消息的 ordinal 作为新 cursor。',
      '配合 search_messages 的命中（conversation_id + ordinal）验证消息上下文。',
    ].join('\n'),
    inputSchema: {
      type: 'object',
      properties: {
        conversation_id: { type: 'string', description: '会话 ID（必填）。' },
        before: { type: 'number', description: `锚点之前返回的消息数（默认 20，最大 ${THREAD_MAX_WINDOW}）。` },
        after: { type: 'number', description: `锚点之后返回的消息数（默认 0，最大 ${THREAD_MAX_WINDOW}）。` },
        cursor: {
          type: 'object',
          description: '可选：锚点 ordinal（缺省为会话最后一条消息）。',
          properties: { ordinal: { type: 'number' } },
          required: ['ordinal'],
        },
      },
      required: ['conversation_id'],
    },
    operationType: 'read',
    inferScope: () => 'workspace',
    validateInput: (input) => {
      if (typeof input.conversation_id !== 'string' || !input.conversation_id.trim()) {
        return 'conversation_id must be a non-empty string'
      }
      if (input.before !== undefined && !isIntInRange(input.before, 0, THREAD_MAX_WINDOW)) {
        return `before must be an integer between 0 and ${THREAD_MAX_WINDOW}`
      }
      if (input.after !== undefined && !isIntInRange(input.after, 0, THREAD_MAX_WINDOW)) {
        return `after must be an integer between 0 and ${THREAD_MAX_WINDOW}`
      }
      if (input.cursor !== undefined && !isMessageCursor(input.cursor)) {
        return 'cursor must be { ordinal: number }'
      }
      return null
    },
    execute: async (input) => {
      const page = await search.getThread({
        conversationId: String(input.conversation_id),
        before: typeof input.before === 'number' ? input.before : undefined,
        after: typeof input.after === 'number' ? input.after : undefined,
        cursor: isMessageCursor(input.cursor) ? input.cursor : undefined,
      })
      return { ok: true, result: JSON.stringify(page) }
    },
  }
}

function createGetTurnTool(search: MessageSearchPort): AgentTool {
  return {
    name: 'get_turn',
    source: 'skill',
    serverName: 'agent-loop',
    description: [
      '返回包含指定消息的完整 turn：本 turn 的用户根消息 + 同 turn 消息 + 关联的压缩边界。',
      '用于验证搜索命中的完整因果上下文（V1 不追溯分支，无 parent 链）。',
    ].join('\n'),
    inputSchema: {
      type: 'object',
      properties: {
        message_id: { type: 'string', description: '消息 ID（必填，来自 search_messages 命中）。' },
      },
      required: ['message_id'],
    },
    operationType: 'read',
    inferScope: () => 'workspace',
    validateInput: (input) => {
      if (typeof input.message_id !== 'string' || !input.message_id.trim()) {
        return 'message_id must be a non-empty string'
      }
      return null
    },
    execute: async (input) => {
      try {
        const turn = await search.getTurn({ messageId: String(input.message_id) })
        return { ok: true, result: JSON.stringify(turn) }
      }
      catch (error) {
        return { ok: false, result: error instanceof Error ? error.message : '获取 turn 失败' }
      }
    },
  }
}

function isIntInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

function isSearchCursor(value: unknown): value is MessageSearchCursor {
  if (!value || typeof value !== 'object') {
    return false
  }
  const cursor = value as Record<string, unknown>
  return typeof cursor.updatedAt === 'number'
    && typeof cursor.conversationId === 'string'
    && typeof cursor.ordinal === 'number'
}

function isMessageCursor(value: unknown): value is MessageCursor {
  return Boolean(value && typeof value === 'object' && typeof (value as Record<string, unknown>).ordinal === 'number')
}
