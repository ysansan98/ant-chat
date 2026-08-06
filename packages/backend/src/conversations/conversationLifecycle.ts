import type { AddConversationsSchema, AddMessage, AgentTaskSnapshot, IConversations, ILogger, IMessage, UpdateConversationsSchema, VisualizationBlock } from '@ant-chat/shared'
import type { ConversationRepository, MessageRepository, WorkspaceService } from '../data'
import type { RuntimeEventBus } from '../events'
import { randomUUID } from 'node:crypto'

interface ConversationDependencies {
  conversationRepository: Pick<ConversationRepository, 'getById' | 'create' | 'update' | 'list' | 'setArchived' | 'delete' | 'deleteArchived' | 'deleteByWorkspace' | 'deleteArchivedByWorkspace' | 'deleteAllArchived' | 'listArchived' | 'listArchivedWorkspaces'>
  messageRepository: Pick<MessageRepository, 'listByConversation' | 'create' | 'getById'>
  workspaceService: Pick<WorkspaceService, 'isWorkspaceAvailable' | 'listWorkspaces' | 'addWorkspace' | 'removeWorkspace'>
  loadAttachmentData: (fileId: string) => Promise<string | null>
}

export interface ConversationLifecycle {
  get: (id: string) => Promise<IConversations>
  create: (input: AddConversationsSchema) => Promise<IConversations>
  beginCreate: (input: AddConversationsSchema) => Promise<ConversationCreation>
  update: (input: UpdateConversationsSchema) => Promise<IConversations>
  fork: (input: { sourceConversationId: string, workspacePath: string }) => Promise<IConversations>
  archive: (id: string) => Promise<IConversations>
  restore: (id: string) => Promise<IConversations>
  delete: (id: string, options?: { archivedOnly?: boolean }) => Promise<string[]>
  clearWorkspace: (workspacePath: string) => Promise<string[]>
  clearArchivedWorkspace: (workspacePath: string | null) => Promise<string[]>
  clearAllArchived: () => Promise<string[]>
}

export interface ConversationCreation {
  conversation: IConversations
  commit: () => void
  rollback: () => Promise<void>
}

export function createConversationLifecycle(options: {
  data: ConversationDependencies
  events: Pick<RuntimeEventBus, 'emit'>
  runtime: {
    closeConversation: (conversationId: string) => Promise<void> | void
    listActiveTasks: (conversationId?: string) => AgentTaskSnapshot[]
  }
  observability?: {
    deleteConversation: (conversationId: string) => Promise<void>
  }
  logger?: ILogger
  now?: () => number
  randomId?: () => string
}): ConversationLifecycle {
  const now = options.now ?? Date.now
  const randomId = options.randomId ?? randomUUID

  async function get(id: string) {
    const conversation = await options.data.conversationRepository.getById(id)
    if (!conversation) {
      throw new Error(`会话不存在：${id}`)
    }
    return conversation
  }

  async function persist(input: AddConversationsSchema) {
    if (!input.workspacePath) {
      throw new Error('缺少工作区路径')
    }
    return await options.data.conversationRepository.create(input)
  }

  async function create(input: AddConversationsSchema) {
    const conversation = await persist(input)
    options.events.emit('conversation:updated', { conversation })
    return conversation
  }

  async function closeConversations(conversations: IConversations[]) {
    for (const conversation of conversations) {
      await options.runtime.closeConversation(conversation.id)
    }
  }

  async function deleteObservability(conversationIds: string[]) {
    for (const conversationId of conversationIds) {
      try {
        await options.observability?.deleteConversation(conversationId)
      }
      catch (error) {
        // 会话已永久删除时，诊断清理失败不能把业务删除伪装成失败。
        options.logger?.warn('清理会话 Agent Observability 证据失败', { conversationId, error })
      }
    }
  }

  async function fork(input: { sourceConversationId: string, workspacePath: string }) {
    const sourceConversation = await get(input.sourceConversationId)
    const sourceMessages = await options.data.messageRepository.listByConversation(sourceConversation.id)
    const timestamp = now()
    const forkConversation = await persist({
      workspacePath: input.workspacePath,
      title: `${sourceConversation.title} 副本`,
      conversationInstructions: sourceConversation.conversationInstructions ?? '',
      settings: { ...sourceConversation.settings },
      createdAt: timestamp,
      updatedAt: timestamp,
    })

    try {
      const messageIdMap = new Map<string, string>()
      const toolCallIdMap = new Map<string, string>()
      for (const message of sourceMessages) {
        const copied = await copyMessage(message, forkConversation.id, messageIdMap, toolCallIdMap, options.data, randomId)
        const created = await options.data.messageRepository.create(copied)
        messageIdMap.set(message.id, created.id)
      }

      // fork 事件必须最后写入：保留源消息 created_at 后，事件时间戳晚于全部复制消息，
      // 即使同一毫秒完成也因 rowid 靠后而排在会话末尾。
      await options.data.messageRepository.create({
        convId: forkConversation.id,
        role: 'event',
        status: 'success',
        content: [{
          type: 'text',
          text: `分叉自：${sourceConversation.title}（${sourceConversation.id}）`,
        }],
        eventType: 'fork',
        createdAt: timestamp,
      })
    }
    catch (error) {
      // conversation delete 通过 repository transaction 级联清理消息和已落盘的 attachment，
      // 因而 fork 不会暴露只复制了一半的会话或 visualization。
      await options.data.conversationRepository.delete(forkConversation.id)
      throw error
    }

    options.events.emit('conversation:updated', { conversation: forkConversation })
    return forkConversation
  }

  return {
    get,
    create,
    async beginCreate(input) {
      const conversation = await persist(input)
      let settled = false
      return {
        conversation,
        commit() {
          if (settled) {
            return
          }
          settled = true
          options.events.emit('conversation:updated', { conversation })
        },
        async rollback() {
          if (settled) {
            return
          }
          await options.data.conversationRepository.delete(conversation.id)
          settled = true
        },
      }
    },
    async update(input) {
      const conversation = await options.data.conversationRepository.update(input)
      options.events.emit('conversation:updated', { conversation })
      return conversation
    },
    fork,
    async archive(id) {
      if (options.runtime.listActiveTasks(id).length > 0) {
        throw new Error('任务运行中，暂时无法归档')
      }
      const conversation = await options.data.conversationRepository.setArchived(id, true)
      options.events.emit('conversation:updated', { conversation })
      return conversation
    },
    async restore(id) {
      const conversation = await get(id)
      if (!conversation.archived) {
        return conversation
      }
      if (!conversation.workspacePath || !options.data.workspaceService.isWorkspaceAvailable(conversation.workspacePath)) {
        throw new Error('原工作区目录不存在或无权访问，无法取消归档')
      }

      const configured = options.data.workspaceService.listWorkspaces().workspaces.some(workspace => workspace.path === conversation.workspacePath)
      let addedWorkspace = false
      if (!configured) {
        options.data.workspaceService.addWorkspace(conversation.workspacePath)
        addedWorkspace = true
        options.events.emit('workspace:changed', {})
      }

      let restored: IConversations
      try {
        restored = await options.data.conversationRepository.setArchived(id, false)
      }
      catch (error) {
        // restore 同时修改 workspace 配置与会话状态；第二步失败必须撤销第一步。
        if (addedWorkspace) {
          options.data.workspaceService.removeWorkspace(conversation.workspacePath)
          options.events.emit('workspace:changed', {})
        }
        throw error
      }
      options.events.emit('conversation:updated', { conversation: restored })
      return restored
    },
    async delete(id, deleteOptions) {
      await options.runtime.closeConversation(id)
      if (deleteOptions?.archivedOnly) {
        const deleted = await options.data.conversationRepository.deleteArchived(id)
        await deleteObservability(deleted)
        return deleted
      }
      await options.data.conversationRepository.delete(id)
      await deleteObservability([id])
      return [id]
    },
    async clearWorkspace(workspacePath) {
      if (!workspacePath) {
        throw new Error('缺少工作区路径')
      }
      const page = await options.data.conversationRepository.list(0, Number.MAX_SAFE_INTEGER, workspacePath, false)
      await closeConversations(page.data)
      if (page.data.length === 0) {
        return []
      }
      const deleted = await options.data.conversationRepository.deleteByWorkspace(workspacePath, false)
      await deleteObservability(deleted)
      return deleted
    },
    async clearArchivedWorkspace(workspacePath) {
      const page = await options.data.conversationRepository.listArchived(0, Number.MAX_SAFE_INTEGER, workspacePath)
      await closeConversations(page.data)
      const deleted = await options.data.conversationRepository.deleteArchivedByWorkspace(workspacePath)
      await deleteObservability(deleted)
      return deleted
    },
    async clearAllArchived() {
      const workspaces = await options.data.conversationRepository.listArchivedWorkspaces()
      const conversations: IConversations[] = []
      for (const workspace of workspaces) {
        const page = await options.data.conversationRepository.listArchived(0, Number.MAX_SAFE_INTEGER, workspace.workspacePath)
        conversations.push(...page.data)
      }
      await closeConversations(conversations)
      const deleted = await options.data.conversationRepository.deleteAllArchived()
      await deleteObservability(deleted)
      return deleted
    },
  }
}

async function copyMessage(
  message: IMessage,
  forkConversationId: string,
  messageIdMap: Map<string, string>,
  toolCallIdMap: Map<string, string>,
  data: Pick<ConversationDependencies, 'loadAttachmentData'>,
  randomId: () => string,
): Promise<AddMessage & { createdAt: number }> {
  const content = await Promise.all((message.content as unknown[]).map(async (block) => {
    if (isVisualizationBlock(block)) {
      const artifact = await data.loadAttachmentData(block.source.file_id)
      if (!artifact) {
        throw new Error(`可视化 artifact 不存在：${block.source.file_id}`)
      }
      return {
        ...block,
        source: { type: 'file_id' as const, file_id: `viz-${randomId()}` },
        data: artifact,
      }
    }
    const candidate = block as { type?: unknown, toolCallId?: unknown }
    if ((candidate.type === 'tool-call' || candidate.type === 'tool-result') && typeof candidate.toolCallId === 'string') {
      return { ...(block as Record<string, unknown>), toolCallId: remapId(candidate.toolCallId, toolCallIdMap, randomId) }
    }
    return block
  }))
  const base = {
    convId: forkConversationId,
    content,
    createdAt: message.createdAt,
    turnId: message.turnId ? (messageIdMap.get(message.turnId) ?? message.turnId) : undefined,
  }

  switch (message.role) {
    case 'user':
      return { ...base, role: 'user', status: 'success' } as AddMessage & { createdAt: number }
    case 'assistant':
      return {
        ...base,
        role: 'assistant',
        status: message.status,
        modelInfo: message.modelInfo ?? { provider: '', model: '' },
        reasoningContent: message.reasoningContent,
        usage: message.usage,
        durationMs: message.durationMs,
      } as AddMessage & { createdAt: number }
    case 'tool':
      return { ...base, role: 'tool', status: message.status === 'error' ? 'error' : 'success' } as AddMessage & { createdAt: number }
    case 'event':
      if (message.status !== 'success' && message.status !== 'loading' && message.status !== 'error') {
        throw new Error(`无效的事件消息状态：${message.status}`)
      }
      return {
        ...base,
        role: 'event',
        status: message.status,
        eventType: message.eventType ?? 'unknown',
        modelInfo: message.modelInfo,
        usage: message.usage,
        compactedThroughMessageId: message.compactedThroughMessageId
          ? messageIdMap.get(message.compactedThroughMessageId)
          : undefined,
      } as AddMessage & { createdAt: number }
  }
}

function isVisualizationBlock(value: unknown): value is VisualizationBlock {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const block = value as Partial<VisualizationBlock>
  return block.type === 'visualization'
    && block.format === 'ant-chat.visualization.html.v1'
    && block.source?.type === 'file_id'
    && typeof block.source.file_id === 'string'
}

function remapId(id: string, mapping: Map<string, string>, randomId: () => string) {
  const existing = mapping.get(id)
  if (existing) {
    return existing
  }
  const next = randomId()
  mapping.set(id, next)
  return next
}
