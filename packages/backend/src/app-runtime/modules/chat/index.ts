import type { AppRpcInput } from '@ant-chat/shared'
import type { createAgentRuntime } from '../../../agent-core'
import type { createConversationTitleGenerator } from '../../../agent-runtime'
import type { RuntimeCore } from '../../createRuntimeCore'
import type { RuntimeModuleMethods } from '../../routeRegistry'
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
