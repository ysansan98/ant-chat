import type { AgentTool, AgentTurnSource, MemoryCatalogPort } from '@ant-chat/shared'

/**
 * 长期记忆目录工具：search_memories（只读）+ propose_memory（只写 pending）。
 *
 * 权限边界：
 * - propose_memory 在自动化 turn 中直接拒绝（automations 无创建/批准记忆的权限）；
 * - approve 始终只允许用户在 UI 操作，agent 无权调用（不暴露为工具）。
 */

const SEARCH_MAX_LIMIT = 20
const TITLE_MAX = 200
const SUMMARY_MAX = 1000
const BODY_MAX = 20_000

export interface CreateMemoryCatalogToolsOptions {
  workspacePath: string
  turnSource?: AgentTurnSource
}

export function createMemoryCatalogTools(
  catalog: MemoryCatalogPort,
  options: CreateMemoryCatalogToolsOptions,
): AgentTool[] {
  return [
    createSearchMemoriesTool(catalog, options.workspacePath),
    createProposeMemoryTool(catalog, options),
  ]
}

function createSearchMemoriesTool(catalog: MemoryCatalogPort, workspacePath: string): AgentTool {
  return {
    name: 'search_memories',
    source: 'skill',
    serverName: 'agent-loop',
    description: [
      '搜索当前工作区已批准的人工长期记忆（仅 active，不返回待批准与已归档）。',
      '记忆是用户确认后的结论层；检索结果可作为回答依据，但不能替代搜索原始消息证据。',
    ].join('\n'),
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词（必填）。' },
        limit: { type: 'number', description: `返回条数上限（默认 5，最大 ${SEARCH_MAX_LIMIT}）。` },
      },
      required: ['query'],
    },
    operationType: 'read',
    inferScope: () => 'workspace',
    validateInput: (input) => {
      if (typeof input.query !== 'string' || !input.query.trim()) {
        return 'query must be a non-empty string'
      }
      if (input.limit !== undefined && (typeof input.limit !== 'number' || !Number.isInteger(input.limit) || input.limit < 1 || input.limit > SEARCH_MAX_LIMIT)) {
        return `limit must be an integer between 1 and ${SEARCH_MAX_LIMIT}`
      }
      return null
    },
    execute: async (input) => {
      const hits = await catalog.search({
        query: String(input.query),
        workspacePath,
        limit: typeof input.limit === 'number' ? input.limit : undefined,
      })
      return { ok: true, result: JSON.stringify(hits) }
    },
  }
}

function createProposeMemoryTool(catalog: MemoryCatalogPort, options: CreateMemoryCatalogToolsOptions): AgentTool {
  return {
    name: 'propose_memory',
    source: 'skill',
    serverName: 'agent-loop',
    description: [
      '提议一条长期记忆（pending 状态，需用户在 UI 批准后才生效并参与检索）。',
      '用于沉淀跨会话有效的项目结论、稳定事实与证据链；不要用于临时任务进度或闲聊。',
      'evidence_message_ids 必须来自 search_messages / get_turn 的真实消息，至少一条。',
      '注意：自动化执行无权提议记忆，调用会被拒绝。',
    ].join('\n'),
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: `记忆标题（必填，≤${TITLE_MAX} 字符）。` },
        summary: { type: 'string', description: `短摘要，进入检索索引（必填，≤${SUMMARY_MAX} 字符）。` },
        body: { type: 'string', description: `记忆正文 Markdown（必填，≤${BODY_MAX} 字符），批准后写入文件。` },
        evidence_message_ids: {
          type: 'array',
          description: '支撑结论的消息 ID（必填，至少一条，来自 search_messages 命中）。',
          items: { type: 'string' },
        },
      },
      required: ['title', 'summary', 'body', 'evidence_message_ids'],
    },
    operationType: 'write',
    inferScope: () => 'workspace',
    validateInput: (input) => {
      if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > TITLE_MAX) {
        return `title must be a non-empty string within ${TITLE_MAX} chars`
      }
      if (typeof input.summary !== 'string' || !input.summary.trim() || input.summary.length > SUMMARY_MAX) {
        return `summary must be a non-empty string within ${SUMMARY_MAX} chars`
      }
      if (typeof input.body !== 'string' || !input.body.trim() || input.body.length > BODY_MAX) {
        return `body must be a non-empty string within ${BODY_MAX} chars`
      }
      if (!Array.isArray(input.evidence_message_ids) || input.evidence_message_ids.length === 0) {
        return 'evidence_message_ids must be a non-empty array'
      }
      if (!input.evidence_message_ids.every(id => typeof id === 'string' && id.trim())) {
        return 'evidence_message_ids must contain non-empty strings'
      }
      return null
    },
    execute: async (input) => {
      if (options.turnSource?.type === 'automation') {
        return { ok: false, result: '自动化 turn 无权创建记忆提议（propose_memory 仅限交互式会话）' }
      }
      const record = await catalog.propose({
        workspacePath: options.workspacePath,
        title: String(input.title).trim(),
        summary: String(input.summary).trim(),
        body: String(input.body).trim(),
        evidenceMessageIds: (input.evidence_message_ids as unknown[]).map(id => String(id).trim()),
      })
      return { ok: true, result: JSON.stringify(record) }
    },
  }
}
