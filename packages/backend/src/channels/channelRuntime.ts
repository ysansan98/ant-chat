/* eslint-disable style/max-statements-per-line */

import type { AddMessage, AgentMode, AgentRuntimeStartTaskResult, ChannelAccount, ChannelPairing, ChannelType, ConversationsSettingsSchema, StartAgentTurnOptions } from '@ant-chat/shared'
import type { AgentTurnService } from '../agent-runtime/agentTurnService'
import type { AppDataContext } from '../data'
import type { ChannelCommand } from './channelCommandParser'
import { canonicalizeWorkspacePath } from '../workspace/workspaceIdentity'
import { parseChannelInput } from './channelCommandParser'

export interface ChannelInboundEvent {
  channelAccountId: string
  channelType: ChannelType
  externalUserId: string
  externalDisplayName: string
  externalChatId: string
  externalMessageId: string
  text: string
}

export type ChannelInboundResult
  = | { kind: 'duplicate' }
    | { kind: 'pairing-required', message: string }
    | { kind: 'configuration-required', message: string }
    | { kind: 'command', message: string, conversationId?: string, presentation?: ChannelCommandPresentation }
    | { kind: 'turn', result: AgentRuntimeStartTaskResult }

export type ChannelCommandPresentation
  = | {
    kind: 'model-selection'
    models: Array<{ providerId: string, modelId: string, label: string, selected: boolean }>
  }
  | {
    kind: 'permission-mode-selection'
    modes: Array<{ value: AgentMode, label: string, selected: boolean }>
  }

export interface ChannelModelOption {
  modelId: string
  providerId: string
  name: string
  providerName?: string
  temperature?: number
  maxOutputTokens?: number
}

const permissionModeLabels: Record<AgentMode, string> = {
  strict: '默认权限',
  hybrid: '自动审查',
  full_managed: '完全访问权限',
}

export interface ChannelRuntimeDeps {
  data: AppDataContext
  turnService: Pick<AgentTurnService, 'startTurn'>
  updateConversation: (input: { id: string, settings: ConversationsSettingsSchema }) => Promise<unknown>
  listModels?: () => ChannelModelOption[]
  stopTask?: (conversationId: string) => Promise<void>
  approvePending?: (conversationId: string) => Promise<void>
  denyPending?: (conversationId: string) => Promise<void>
  listActiveTasks?: (conversationId: string) => Array<{ taskId: string, status: string, pendingAction?: { actionId: string } }>
  now?: () => number
}

export class ChannelRuntime {
  private readonly now: () => number
  constructor(private readonly deps: ChannelRuntimeDeps) { this.now = deps.now ?? Date.now }

  async handleInbound(event: ChannelInboundEvent): Promise<ChannelInboundResult> {
    const account = await this.deps.data.channelAccountRepository.getById(event.channelAccountId)
    if (!account)
      return { kind: 'configuration-required', message: '频道账号不存在，请先在设置中完成配置。' }
    if (!account.enabled || !account.defaultWorkspacePath || !this.isRegisteredWorkspace(account.defaultWorkspacePath)) {
      return { kind: 'configuration-required', message: '频道尚未配置可用的默认工作区，请先在设置中完成配置。' }
    }
    const pairing = await this.authorizePairing(account, event)
    if (!pairing)
      return { kind: 'pairing-required', message: '此消息身份尚未配对，请在设置中批准配对请求。' }
    const existingReceipt = await this.deps.data.channelReceiptRepository.get(event.channelAccountId, event.externalMessageId, 'inbound')
    if (existingReceipt)
      return { kind: 'duplicate' }
    const session = await this.getOrCreateSession(account, event)
    const parsed = parseChannelInput(event.text)
    if (parsed.kind === 'error') {
      await this.persistReceiptAndEvent(event, session.activeConversationId)
      return { kind: 'command', message: parsed.message, conversationId: session.activeConversationId }
    }
    if (parsed.kind === 'command') {
      const receipt = await this.createInboundReceipt(event)
      try {
        const result = await this.handleCommand(parsed.command, event, session)
        await this.persistCommandEvent(event, result.conversationId, receipt.id)
        return {
          kind: 'command',
          message: result.message,
          conversationId: result.conversationId,
          ...(result.presentation ? { presentation: result.presentation } : {}),
        }
      }
      catch (error) {
        await this.deps.data.channelReceiptRepository.updateStatus(receipt.id, 'failed', error instanceof Error ? error.message : String(error))
        throw error
      }
    }
    const modelConfig = await this.getModelConfig(session.activeConversationId)
    if (!modelConfig) {
      const message = '当前没有可用模型，请先在设置中启用模型。'
      await this.persistReceiptAndEvent(event, session.activeConversationId)
      return { kind: 'configuration-required', message }
    }
    const receipt = await this.createInboundReceipt(event)
    const options: StartAgentTurnOptions = {
      conversationId: session.activeConversationId,
      messageContent: [{ type: 'text', text: parsed.text }],
      workspacePath: session.currentWorkspacePath,
      modelConfig,
      mode: account.permissionMode,
      userMessageId: receipt.localMessageId,
      turnSource: { type: 'channel', channelType: event.channelType, channelAccountId: event.channelAccountId, externalUserId: event.externalUserId, externalChatId: event.externalChatId, externalMessageId: event.externalMessageId },
    }
    try {
      const result = await this.deps.turnService.startTurn(options)
      await this.deps.data.channelReceiptRepository.updateStatus(receipt.id, 'received', undefined, result.userMessageId)
      return { kind: 'turn', result }
    }
    catch (error) {
      await this.deps.data.channelReceiptRepository.updateStatus(receipt.id, 'failed', error instanceof Error ? error.message : String(error))
      throw error
    }
  }

  async executeCommand(input: { event: ChannelInboundEvent, conversationId: string, command: ChannelCommand }): Promise<string> {
    const session = await this.deps.data.channelSessionRepository.get(input.event.channelAccountId, input.event.externalChatId)
    if (!session || session.activeConversationId !== input.conversationId)
      throw new Error('频道会话已失效，请重试。')
    return (await this.handleCommand(input.command, input.event, session)).message
  }

  async selectModel(conversationId: string, providerId: string, modelId: string): Promise<string> {
    const model = this.findModel(providerId, modelId)
    if (!model)
      throw new Error('该模型已不可用，请重新发送 /models。')
    const conversation = await this.deps.data.conversationRepository.getById(conversationId)
    await this.deps.updateConversation({
      id: conversationId,
      settings: toModelConfig(model, conversation.settings.reasoningEffort),
    })
    return `已切换模型：${formatModel(model)}`
  }

  async selectPermissionMode(channelAccountId: string, permissionMode: AgentMode): Promise<string> {
    await this.deps.data.channelAccountRepository.updatePermissionMode(channelAccountId, permissionMode)
    return `已切换权限模式：${formatPermissionMode(permissionMode)}`
  }

  private async handleCommand(command: ChannelCommand, event: ChannelInboundEvent, session: { activeConversationId: string, currentWorkspacePath: string, createdAt?: number }): Promise<{ conversationId: string, message: string, presentation?: ChannelCommandPresentation }> {
    const result = (message: string, conversationId = session.activeConversationId, presentation?: ChannelCommandPresentation) => ({ conversationId, message, presentation })
    switch (command.id) {
      case 'new': {
        const workspacePath = command.path ? this.validateWorkspace(command.path) : session.currentWorkspacePath
        const current = await this.deps.data.conversationRepository.getById(session.activeConversationId)
        const conversation = await this.deps.data.conversationRepository.create({ title: 'Untitled', workspacePath, createdAt: this.now(), updatedAt: this.now(), conversationInstructions: '', settings: current.settings, sourceType: current.sourceType ?? 'feishu', sourceChannelAccountId: event.channelAccountId, sourceExternalChatId: event.externalChatId })
        await this.deps.data.channelSessionRepository.upsert({ channelAccountId: event.channelAccountId, externalChatId: event.externalChatId, activeConversationId: conversation.id, currentWorkspacePath: workspacePath, createdAt: sessionCreatedAt(session), updatedAt: this.now() })
        const account = await this.deps.data.channelAccountRepository.getById(event.channelAccountId)
        return result(`已创建新会话\n${this.formatContext(conversation, workspacePath, account.permissionMode)}`, conversation.id)
      }
      case 'model': return result(await this.setModel(session.activeConversationId, command.query))
      case 'mode': {
        if (command.query)
          return result(await this.setPermissionMode(event.channelAccountId, command.query))
        const account = await this.deps.data.channelAccountRepository.getById(event.channelAccountId)
        return result('请选择权限模式。', session.activeConversationId, {
          kind: 'permission-mode-selection',
          modes: (Object.entries(permissionModeLabels) as Array<[AgentMode, string]>).map(([value, label]) => ({
            value,
            label,
            selected: value === account.permissionMode,
          })),
        })
      }
      case 'models': {
        const conversation = await this.deps.data.conversationRepository.getById(session.activeConversationId)
        const models = this.getModels()
        return result(
          models.map(formatModel).join('\n') || '当前没有可用模型。',
          session.activeConversationId,
          models.length
            ? {
                kind: 'model-selection',
                models: models.map(model => ({
                  providerId: model.providerId,
                  modelId: model.modelId,
                  label: formatModel(model),
                  selected: model.providerId === conversation.settings.providerId && model.modelId === conversation.settings.modelId,
                })),
              }
            : undefined,
        )
      }
      case 'steer': await this.deps.data.messageRepository.create({ convId: session.activeConversationId, role: 'user', status: 'success', content: [{ type: 'text', text: command.text }], turnId: session.activeConversationId, eventType: 'steering' } as AddMessage); return result('已记录 steering。')
      case 'stop': await this.deps.stopTask?.(session.activeConversationId); return result('已请求停止当前任务。')
      case 'status': {
        const [conversation, account] = await Promise.all([
          this.deps.data.conversationRepository.getById(session.activeConversationId),
          this.deps.data.channelAccountRepository.getById(event.channelAccountId),
        ])
        return result(`当前会话：${session.activeConversationId}\n${this.formatContext(conversation, session.currentWorkspacePath, account.permissionMode)}`)
      }
      case 'help': return result('/new [path]\n/model <名称>\n/models\n/mode <默认权限|自动审查|完全访问权限>\n/steer <文本>\n/stop\n/status\n/approve\n/deny')
      case 'approve': await this.deps.approvePending?.(session.activeConversationId); return result('已批准当前队首操作。')
      case 'deny': await this.deps.denyPending?.(session.activeConversationId); return result('已拒绝当前队首操作。')
    }
  }

  private async authorizePairing(account: ChannelAccount, event: ChannelInboundEvent): Promise<ChannelPairing | undefined> {
    const existing = await this.deps.data.channelPairingRepository.get(account.id, event.externalUserId)
    if (existing?.status === 'authorized')
      return existing
    if (!existing || (existing.expiresAt !== undefined && existing.expiresAt <= this.now()))
      await this.deps.data.channelPairingRepository.upsert({ id: `pair-${account.id}-${event.externalUserId}`, channelAccountId: account.id, externalUserId: event.externalUserId, externalDisplayName: event.externalDisplayName, status: 'pending', requestedAt: this.now(), expiresAt: this.now() + 86_400_000 })
    return undefined
  }

  private async getOrCreateSession(account: ChannelAccount, event: ChannelInboundEvent) {
    const existing = await this.deps.data.channelSessionRepository.get(account.id, event.externalChatId)
    if (existing)
      return existing
    const settings = await this.deps.data.settingsRepository.getGeneralSettings()
    const preferred = this.findModel(settings.assistantProviderId, settings.assistantModelId) ?? this.getModels()[0]
    const conversation = await this.deps.data.conversationRepository.create({ title: 'Untitled', workspacePath: account.defaultWorkspacePath!, createdAt: this.now(), updatedAt: this.now(), conversationInstructions: '', settings: preferred ? toModelConfig(preferred, settings.reasoningEffort) : { modelId: '', providerId: '', temperature: 0.7, maxOutputTokens: 4096, reasoningEffort: settings.reasoningEffort }, sourceType: event.channelType, sourceChannelAccountId: account.id, sourceExternalChatId: event.externalChatId })
    return this.deps.data.channelSessionRepository.upsert({ channelAccountId: account.id, externalChatId: event.externalChatId, activeConversationId: conversation.id, currentWorkspacePath: account.defaultWorkspacePath!, createdAt: this.now(), updatedAt: this.now() })
  }

  private async getModelConfig(conversationId: string): Promise<StartAgentTurnOptions['modelConfig'] | undefined> {
    const conversation = await this.deps.data.conversationRepository.getById(conversationId)
    if (!this.deps.listModels)
      return conversation.settings
    if (this.findModel(conversation.settings.providerId, conversation.settings.modelId))
      return conversation.settings
    const settings = await this.deps.data.settingsRepository.getGeneralSettings()
    const fallback = this.findModel(settings.assistantProviderId, settings.assistantModelId) ?? this.getModels()[0]
    if (!fallback)
      return undefined
    const modelConfig = toModelConfig(fallback, conversation.settings.reasoningEffort ?? settings.reasoningEffort)
    await this.deps.updateConversation({ id: conversationId, settings: modelConfig })
    return modelConfig
  }

  private validateWorkspace(input: string): string {
    const normalized = canonicalizeWorkspacePath(input.trim()); if (!normalized || !this.isRegisteredWorkspace(normalized))
      throw new Error('工作区路径不存在、不可访问或未登记。'); return normalized
  }

  private async setModel(conversationId: string, query: string) {
    const normalized = query.toLowerCase()
    const matches = this.getModels().filter((model) => {
      return [model.name, model.modelId, formatModel(model), `${model.providerId}/${model.modelId}`]
        .some(value => value.toLowerCase().includes(normalized))
    })
    if (matches.length !== 1)
      return matches.length ? `模型名称不唯一：\n${matches.map(formatModel).join('\n')}` : '未找到匹配模型。'
    const conversation = await this.deps.data.conversationRepository.getById(conversationId)
    await this.deps.updateConversation({ id: conversationId, settings: toModelConfig(matches[0], conversation.settings.reasoningEffort) })
    return `已切换模型：${formatModel(matches[0])}`
  }

  private async setPermissionMode(channelAccountId: string, query: string): Promise<string> {
    const permissionMode = parsePermissionMode(query)
    if (!permissionMode)
      return '用法：/mode <默认权限|自动审查|完全访问权限>'
    return this.selectPermissionMode(channelAccountId, permissionMode)
  }

  private formatContext(conversation: { settings: ConversationsSettingsSchema }, workspacePath: string, permissionMode: AgentMode): string {
    const configured = this.findModel(conversation.settings.providerId, conversation.settings.modelId)
    const model = configured
      ? formatModel(configured)
      : [conversation.settings.providerId, conversation.settings.modelId].filter(Boolean).join('/') || '未配置'
    return `工作区：${workspacePath}\n当前模型：${model}\n权限模式：${formatPermissionMode(permissionMode)}`
  }

  private getModels(): ChannelModelOption[] { return this.deps.listModels?.() ?? [] }
  private findModel(providerId: string, modelId: string): ChannelModelOption | undefined { return this.getModels().find(model => model.providerId === providerId && model.modelId === modelId) }
  private createInboundReceipt(event: ChannelInboundEvent) { return this.deps.data.channelReceiptRepository.create({ channelAccountId: event.channelAccountId, externalChatId: event.externalChatId, externalMessageId: event.externalMessageId, direction: 'inbound', status: 'received' }) }
  private async persistReceiptAndEvent(event: ChannelInboundEvent, conversationId: string) { const receipt = await this.createInboundReceipt(event); await this.persistCommandEvent(event, conversationId, receipt.id) }
  private async persistCommandEvent(event: ChannelInboundEvent, conversationId: string, receiptId: string) { const message = await this.deps.data.messageRepository.create({ convId: conversationId, role: 'event', status: 'success', content: [{ type: 'text', text: event.text }], eventType: 'channel-command' } as AddMessage); await this.deps.data.channelReceiptRepository.updateStatus(receiptId, 'received', undefined, message.id) }
  private isRegisteredWorkspace(input: string): boolean { return this.deps.data.workspaceService.listWorkspaces().workspaces.some(workspace => workspace.path === input) && this.deps.data.workspaceService.isWorkspaceAvailable(input) }
}

function sessionCreatedAt(session: { createdAt?: number }): number { return session.createdAt ?? Date.now() }

function toModelConfig(model: ChannelModelOption, reasoningEffort?: StartAgentTurnOptions['modelConfig']['reasoningEffort']): ConversationsSettingsSchema {
  return { modelId: model.modelId, providerId: model.providerId, temperature: model.temperature ?? 0.7, maxOutputTokens: model.maxOutputTokens ?? 4096, reasoningEffort }
}

function formatModel(model: ChannelModelOption): string {
  return model.providerName ? `${model.providerName} / ${model.name}` : model.name
}

function parsePermissionMode(input: string): AgentMode | undefined {
  const normalized = input.trim().toLowerCase().replace(/-/g, '_')
  return (Object.entries(permissionModeLabels) as Array<[AgentMode, string]>)
    .find(([mode, label]) => mode === normalized || label === input.trim())?.[0]
}

function formatPermissionMode(mode: AgentMode): string {
  return permissionModeLabels[mode]
}
