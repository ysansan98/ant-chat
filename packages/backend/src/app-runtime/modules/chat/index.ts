import type { AppRpcInput } from '@ant-chat/shared'
import type { createConversationTitleGenerator } from '../../../agent-runtime'
import type { ConversationLifecycle } from '../../../conversations/conversationLifecycle'
import type { ConversationRepository, MessageRepository, WorkspaceService } from '../../../data'
import type { RuntimeModuleMethods } from '../../routeRegistry'
import path from 'node:path'
import { AddMessage, UpdateMessageSchema } from '@ant-chat/shared'
import { Method, Module } from '../../decorators'

@Module('chat')
export class ChatModule implements RuntimeModuleMethods<'chat'> {
  constructor(
    private readonly conversationRepository: ConversationRepository,
    private readonly messageRepository: MessageRepository,
    private readonly workspaceService: WorkspaceService,
    private readonly conversationLifecycle: ConversationLifecycle,
    private readonly titleGenerator: ReturnType<typeof createConversationTitleGenerator>,
  ) {}

  @Method()
  async createConversationsTitle(input: AppRpcInput<'chat.createConversationsTitle'>) {
    const conversation = await this.titleGenerator.updateTitle(input.conversationsId, {
      providerId: input.providerId,
      modelId: input.modelId,
    })
    if (!conversation) {
      throw new Error(`Conversation title was not updated: ${input.conversationsId}`)
    }
    return conversation
  }

  @Method()
  getConversations(input: AppRpcInput<'chat.getConversations'>) {
    return this.conversationRepository.list(input.pageIndex, input.pageSize, undefined, false)
  }

  @Method()
  getWorkspaceConversations(input: AppRpcInput<'chat.getWorkspaceConversations'>) {
    return this.conversationRepository.list(input.pageIndex, input.pageSize, input.workspacePath, false)
  }

  @Method()
  async getArchivedConversationWorkspaces(input: AppRpcInput<'chat.getArchivedConversationWorkspaces'>) {
    const query = input.query?.trim() ?? ''
    const pageSize = Math.min(Math.max(input.pageSize, 1), 100)
    const [allWorkspaces, matchedWorkspaces] = await Promise.all([
      this.conversationRepository.listArchivedWorkspaces(),
      query
        ? this.conversationRepository.listArchivedWorkspaces(query)
        : Promise.resolve(null),
    ])
    const matched = matchedWorkspaces ?? allWorkspaces
    const totalByPath = new Map(allWorkspaces.map(workspace => [workspace.workspacePath, workspace.total]))
    const configuredWorkspaces = this.workspaceService.listWorkspaces().workspaces
    const configuredByPath = new Map(configuredWorkspaces.map((workspace, index) => [workspace.path, { ...workspace, index }]))

    const workspaces = await Promise.all(matched.map(async (workspace) => {
      const page = await this.conversationRepository.listArchived(0, pageSize, workspace.workspacePath, query)
      const configured = workspace.workspacePath === null ? undefined : configuredByPath.get(workspace.workspacePath)
      return {
        workspacePath: workspace.workspacePath,
        displayName: workspace.workspacePath === null
          ? '未关联工作区'
          : configured?.displayName ?? path.basename(workspace.workspacePath),
        total: totalByPath.get(workspace.workspacePath) ?? workspace.total,
        matchedTotal: workspace.total,
        available: workspace.workspacePath !== null && this.workspaceService.isWorkspaceAvailable(workspace.workspacePath),
        conversations: page.data,
        order: configured?.index,
      }
    }))

    workspaces.sort((left, right) => {
      if (left.workspacePath === null && right.workspacePath === null)
        return 0
      if (left.workspacePath === null)
        return 1
      if (right.workspacePath === null)
        return -1
      if (left.order !== undefined && right.order !== undefined)
        return left.order - right.order
      if (left.order !== undefined)
        return -1
      if (right.order !== undefined)
        return 1
      return left.displayName.localeCompare(right.displayName)
    })

    return {
      total: allWorkspaces.reduce((sum, workspace) => sum + workspace.total, 0),
      workspaces: workspaces.map(({ order: _order, ...workspace }) => workspace),
    }
  }

  @Method()
  getArchivedConversations(input: AppRpcInput<'chat.getArchivedConversations'>) {
    return this.conversationRepository.listArchived(
      input.pageIndex,
      input.pageSize,
      input.workspacePath,
      input.query,
    )
  }

  @Method()
  getConversationById(input: AppRpcInput<'chat.getConversationById'>) {
    return this.conversationLifecycle.get(input.id)
  }

  @Method()
  async addConversation(input: AppRpcInput<'chat.addConversation'>) {
    return await this.conversationLifecycle.create(input.conversation)
  }

  @Method()
  async updateConversation(input: AppRpcInput<'chat.updateConversation'>) {
    return await this.conversationLifecycle.update(input.conversation)
  }

  @Method()
  async deleteConversation(input: AppRpcInput<'chat.deleteConversation'>) {
    await this.conversationLifecycle.delete(input.id)
    return null
  }

  @Method()
  async archiveConversation(input: AppRpcInput<'chat.archiveConversation'>) {
    return await this.conversationLifecycle.archive(input.id)
  }

  @Method()
  async restoreConversation(input: AppRpcInput<'chat.restoreConversation'>) {
    return await this.conversationLifecycle.restore(input.id)
  }

  @Method()
  async deleteArchivedConversation(input: AppRpcInput<'chat.deleteArchivedConversation'>) {
    return await this.conversationLifecycle.delete(input.id, { archivedOnly: true })
  }

  @Method()
  async deleteArchivedWorkspaceConversations(input: AppRpcInput<'chat.deleteArchivedWorkspaceConversations'>) {
    return await this.conversationLifecycle.clearArchivedWorkspace(input.workspacePath)
  }

  @Method()
  async deleteAllArchivedConversations(_input: AppRpcInput<'chat.deleteAllArchivedConversations'>) {
    return await this.conversationLifecycle.clearAllArchived()
  }

  @Method()
  async clearWorkspaceConversations(input: AppRpcInput<'chat.clearWorkspaceConversations'>) {
    return await this.conversationLifecycle.clearWorkspace(input.workspacePath)
  }

  @Method()
  getMessagesByConvId(input: AppRpcInput<'chat.getMessagesByConvId'>) {
    return this.messageRepository.listByConversation(input.convId)
  }

  @Method()
  getMessageById(input: AppRpcInput<'chat.getMessageById'>) {
    return requireValue(this.messageRepository.getById(input.id), `Message not found: ${input.id}`)
  }

  @Method()
  addMessage(input: AppRpcInput<'chat.addMessage'>) {
    rejectClientVisualization(input.message.content)
    return this.messageRepository.create(AddMessage.parse(input.message))
  }

  @Method()
  async updateMessage(input: AppRpcInput<'chat.updateMessage'>) {
    const existing = await this.messageRepository.getById(input.message.id)
    if (input.message.content !== undefined) {
      assertClientVisualizationUpdate(existing.content, input.message.content)
    }
    return this.messageRepository.update(UpdateMessageSchema.parse(input.message))
  }

  @Method()
  async deleteMessage(input: AppRpcInput<'chat.deleteMessage'>) {
    await this.messageRepository.delete(input.id)
    return null
  }

  @Method()
  async batchDeleteMessages(input: AppRpcInput<'chat.batchDeleteMessages'>) {
    await this.messageRepository.batchDelete(input.ids)
    return null
  }
}

function requireValue<T>(value: T, message: string): NonNullable<T> {
  if (value === undefined || value === null)
    throw new Error(message)
  return value as NonNullable<T>
}

function rejectClientVisualization(content: unknown): void {
  if (extractVisualizationBlocks(content).length > 0) {
    throw new Error('visualization 只能由 publish_visualization 工具创建')
  }
}

function assertClientVisualizationUpdate(existingContent: unknown, nextContent: unknown): void {
  const existing = extractVisualizationBlocks(existingContent)
  const next = extractVisualizationBlocks(nextContent)
  if (existing.length === 0 && next.length === 0) {
    return
  }
  if (existing.length === 0) {
    throw new Error('visualization 只能由 publish_visualization 工具创建')
  }
  if (next.length !== existing.length || next.some(block => 'data' in block && block.data !== undefined)) {
    throw new Error('visualization 快照不可通过客户端替换或删除')
  }
  const normalizedExisting = existing.map(normalizeVisualizationBlock)
  const normalizedNext = next.map(normalizeVisualizationBlock)
  if (JSON.stringify(normalizedExisting) !== JSON.stringify(normalizedNext)) {
    throw new Error('visualization 快照不可通过客户端替换或删除')
  }
}

function extractVisualizationBlocks(content: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(content)) {
    return []
  }
  return content.filter((block): block is Record<string, unknown> => {
    return Boolean(block)
      && typeof block === 'object'
      && !Array.isArray(block)
      && (block as { type?: unknown }).type === 'visualization'
  })
}

function normalizeVisualizationBlock(block: Record<string, unknown>): Record<string, unknown> {
  const { data: _data, ...withoutData } = block
  return withoutData
}
