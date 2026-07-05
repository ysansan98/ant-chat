import type { AppRpcInput } from '@ant-chat/shared'
import type { createAgentRuntime } from '../../../agent-core'
import type { createConversationTitleGenerator } from '../../../agent-runtime'
import type { RuntimeCore } from '../../createRuntimeCore'
import type { RuntimeModuleMethods } from '../../routeRegistry'
import path from 'node:path'
import { AddMessage, UpdateMessageSchema } from '@ant-chat/shared'
import { Method, Module } from '../../decorators'

@Module('chat')
export class ChatModule implements RuntimeModuleMethods<'chat'> {
  constructor(
    private readonly core: Pick<RuntimeCore, 'data' | 'events'>,
    private readonly agentRuntime: ReturnType<typeof createAgentRuntime>,
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
    this.core.events.emit('conversation:updated', { conversation })
    return conversation
  }

  @Method()
  getConversations(input: AppRpcInput<'chat.getConversations'>) {
    return this.core.data.conversationRepository.list(input.pageIndex, input.pageSize, undefined, false)
  }

  @Method()
  getWorkspaceConversations(input: AppRpcInput<'chat.getWorkspaceConversations'>) {
    return this.core.data.conversationRepository.list(input.pageIndex, input.pageSize, input.workspacePath, false)
  }

  @Method()
  async getArchivedConversationWorkspaces(input: AppRpcInput<'chat.getArchivedConversationWorkspaces'>) {
    const query = input.query?.trim() ?? ''
    const pageSize = Math.min(Math.max(input.pageSize, 1), 100)
    const [allWorkspaces, matchedWorkspaces] = await Promise.all([
      this.core.data.conversationRepository.listArchivedWorkspaces(),
      query
        ? this.core.data.conversationRepository.listArchivedWorkspaces(query)
        : Promise.resolve(null),
    ])
    const matched = matchedWorkspaces ?? allWorkspaces
    const totalByPath = new Map(allWorkspaces.map(workspace => [workspace.workspacePath, workspace.total]))
    const configuredWorkspaces = this.core.data.workspaceService.listWorkspaces().workspaces
    const configuredByPath = new Map(configuredWorkspaces.map((workspace, index) => [workspace.path, { ...workspace, index }]))

    const workspaces = await Promise.all(matched.map(async (workspace) => {
      const page = await this.core.data.conversationRepository.listArchived(0, pageSize, workspace.workspacePath, query)
      const configured = workspace.workspacePath === null ? undefined : configuredByPath.get(workspace.workspacePath)
      return {
        workspacePath: workspace.workspacePath,
        displayName: workspace.workspacePath === null
          ? '未关联工作区'
          : configured?.displayName ?? path.basename(workspace.workspacePath),
        total: totalByPath.get(workspace.workspacePath) ?? workspace.total,
        matchedTotal: workspace.total,
        available: workspace.workspacePath !== null && this.core.data.workspaceService.isWorkspaceAvailable(workspace.workspacePath),
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
    return this.core.data.conversationRepository.listArchived(
      input.pageIndex,
      input.pageSize,
      input.workspacePath,
      input.query,
    )
  }

  @Method()
  getConversationById(input: AppRpcInput<'chat.getConversationById'>) {
    return requireValue(this.core.data.conversationRepository.getById(input.id), `Conversation not found: ${input.id}`)
  }

  @Method()
  async addConversation(input: AppRpcInput<'chat.addConversation'>) {
    if (!input.conversation.workspacePath) {
      throw new Error('workspacePath is required')
    }
    const conversation = await this.core.data.conversationRepository.create(input.conversation)
    this.core.events.emit('conversation:updated', { conversation })
    return conversation
  }

  @Method()
  async updateConversation(input: AppRpcInput<'chat.updateConversation'>) {
    const conversation = await this.core.data.conversationRepository.update(input.conversation)
    this.core.events.emit('conversation:updated', { conversation })
    return conversation
  }

  @Method()
  async deleteConversation(input: AppRpcInput<'chat.deleteConversation'>) {
    await this.agentRuntime.closeConversation(input.id)
    await this.core.data.conversationRepository.delete(input.id)
    return null
  }

  @Method()
  async archiveConversation(input: AppRpcInput<'chat.archiveConversation'>) {
    if (this.agentRuntime.listActiveTasks(input.id).length > 0) {
      throw new Error('任务运行中，暂时无法归档')
    }
    const conversation = await this.core.data.conversationRepository.setArchived(input.id, true)
    this.core.events.emit('conversation:updated', { conversation })
    return conversation
  }

  @Method()
  async restoreConversation(input: AppRpcInput<'chat.restoreConversation'>) {
    const conversation = await this.core.data.conversationRepository.getById(input.id)
    if (!conversation.archived) {
      return conversation
    }
    if (!conversation.workspacePath || !this.core.data.workspaceService.isWorkspaceAvailable(conversation.workspacePath)) {
      throw new Error('原工作区目录不存在或无权访问，无法取消归档')
    }

    const configured = this.core.data.workspaceService.listWorkspaces().workspaces.some(workspace => workspace.path === conversation.workspacePath)
    if (!configured) {
      this.core.data.workspaceService.addWorkspace(conversation.workspacePath)
      this.core.events.emit('workspace:changed', {})
    }

    const restored = await this.core.data.conversationRepository.setArchived(input.id, false)
    this.core.events.emit('conversation:updated', { conversation: restored })
    return restored
  }

  @Method()
  async deleteArchivedConversation(input: AppRpcInput<'chat.deleteArchivedConversation'>) {
    await this.agentRuntime.closeConversation(input.id)
    return await this.core.data.conversationRepository.deleteArchived(input.id)
  }

  @Method()
  async deleteArchivedWorkspaceConversations(input: AppRpcInput<'chat.deleteArchivedWorkspaceConversations'>) {
    const result = await this.core.data.conversationRepository.listArchived(0, Number.MAX_SAFE_INTEGER, input.workspacePath)
    for (const conversation of result.data) {
      await this.agentRuntime.closeConversation(conversation.id)
    }
    return await this.core.data.conversationRepository.deleteArchivedByWorkspace(input.workspacePath)
  }

  @Method()
  async deleteAllArchivedConversations(_input: AppRpcInput<'chat.deleteAllArchivedConversations'>) {
    const workspaces = await this.core.data.conversationRepository.listArchivedWorkspaces()
    for (const workspace of workspaces) {
      const result = await this.core.data.conversationRepository.listArchived(0, Number.MAX_SAFE_INTEGER, workspace.workspacePath)
      for (const conversation of result.data) {
        await this.agentRuntime.closeConversation(conversation.id)
      }
    }
    return await this.core.data.conversationRepository.deleteAllArchived()
  }

  @Method()
  async clearWorkspaceConversations(input: AppRpcInput<'chat.clearWorkspaceConversations'>) {
    if (!input.workspacePath) {
      throw new Error('workspacePath is required')
    }
    const result = await this.core.data.conversationRepository.list(0, Number.MAX_SAFE_INTEGER, input.workspacePath, false)
    for (const conversation of result.data) {
      await this.agentRuntime.closeConversation(conversation.id)
    }
    if (result.data.length === 0) {
      return []
    }
    return await this.core.data.conversationRepository.deleteByWorkspace(input.workspacePath, false)
  }

  @Method()
  getMessagesByConvId(input: AppRpcInput<'chat.getMessagesByConvId'>) {
    return this.core.data.messageRepository.listByConversation(input.convId)
  }

  @Method()
  getMessageById(input: AppRpcInput<'chat.getMessageById'>) {
    return requireValue(this.core.data.messageRepository.getById(input.id), `Message not found: ${input.id}`)
  }

  @Method()
  addMessage(input: AppRpcInput<'chat.addMessage'>) {
    return this.core.data.messageRepository.create(AddMessage.parse(input.message))
  }

  @Method()
  updateMessage(input: AppRpcInput<'chat.updateMessage'>) {
    return this.core.data.messageRepository.update(UpdateMessageSchema.parse(input.message))
  }

  @Method()
  async deleteMessage(input: AppRpcInput<'chat.deleteMessage'>) {
    await this.core.data.messageRepository.delete(input.id)
    return null
  }

  @Method()
  async batchDeleteMessages(input: AppRpcInput<'chat.batchDeleteMessages'>) {
    await this.core.data.messageRepository.batchDelete(input.ids)
    return null
  }
}

function requireValue<T>(value: T, message: string): NonNullable<T> {
  if (value === undefined || value === null)
    throw new Error(message)
  return value as NonNullable<T>
}
