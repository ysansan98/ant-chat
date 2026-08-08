/* eslint-disable style/max-statements-per-line */

import type { AgentTaskSnapshot, ApprovePendingActionOptions, AppRpcInput, CancelTaskOptions, ChannelAccount, ChannelAccountView, ChannelAttachmentSender, ChannelSetupResult, ChannelType, ConversationsSettingsSchema, IMessage, RejectPendingActionOptions } from '@ant-chat/shared'
import type { AgentTurnService } from '../../../agent-runtime/agentTurnService'
import type { ChannelActionEvent, ChannelActionResult, ChannelConnector } from '../../../channels'
import type { RuntimeCore } from '../../createRuntimeCore'
import type { RuntimeModuleMethods } from '../../routeRegistry'
import type { RuntimeModule } from '../../runtimeModule'
import { randomUUID } from 'node:crypto'
import { ChannelActionHandler, ChannelDelivery, ChannelRuntime } from '../../../channels'
import { FeishuAppRegistration } from '../../../channels/feishu'
import { parseWeixinCredential, WeixinAppRegistration } from '../../../channels/weixin'
import { Method, Module } from '../../decorators'

export interface ChannelAgentDependencies {
  turnService: Pick<AgentTurnService, 'startTurn'>
  updateConversation: (input: { id: string, settings: ConversationsSettingsSchema }) => Promise<unknown>
  listActiveTasks: (conversationId?: string) => AgentTaskSnapshot[]
  cancelTask: (options: CancelTaskOptions) => void
  approvePendingAction: (options: ApprovePendingActionOptions) => void
  rejectPendingAction: (options: RejectPendingActionOptions) => void
  rejectSecretRequest: (options: { requestId: string, reason?: string }) => void
  injectSteering: (conversationId: string, text: string) => Promise<IMessage>
}

@Module('channel')
export class ChannelModule implements RuntimeModuleMethods<'channel'>, RuntimeModule {
  readonly runtime: ChannelRuntime
  private readonly delivery: ChannelDelivery
  private readonly actionHandler: ChannelActionHandler
  private readonly connectors: Map<ChannelType, ChannelConnector>
  private readonly feishuRegistration = new FeishuAppRegistration()
  private readonly weixinRegistration: WeixinAppRegistration
  private readonly setupAccounts = new Map<string, string>()
  private readonly setupChannelTypes = new Map<string, ChannelType>()
  constructor(private readonly core: Pick<RuntimeCore, 'data' | 'events' | 'logger' | 'secretStore'>, agent: ChannelAgentDependencies, connectors: ChannelConnector[] = []) {
    this.connectors = new Map(connectors.map(connector => [connector.type, connector]))
    this.weixinRegistration = new WeixinAppRegistration(core.logger)
    this.runtime = new ChannelRuntime({
      data: core.data,
      turnService: agent.turnService,
      updateConversation: agent.updateConversation,
      stopTask: async (conversationId) => {
        const task = agent.listActiveTasks(conversationId)
          .find(item => ['running', 'awaiting_approval'].includes(item.status))
        if (!task)
          throw new Error('当前会话没有正在执行的任务。')
        agent.cancelTask({ taskId: task.taskId })
      },
      listModels: () => core.data.providerSettingsRepository.getAllAvailableModels().flatMap(provider => provider.models.map(model => ({
        modelId: model.id,
        providerId: model.providerId,
        name: model.name,
        providerName: provider.name,
      }))),
      listActiveTasks: conversationId => agent.listActiveTasks(conversationId).filter(task => task.status === 'awaiting_approval').map(task => ({ taskId: task.taskId, status: task.status, pendingAction: task.pendingAction })),
      // /steer 注入语义：有运行/等待审批任务时注入下一个迭代，否则返回 null 由 ChannelRuntime 落库等待下一轮。
      injectSteering: async (conversationId, text) => {
        const running = agent.listActiveTasks(conversationId).some(item => ['running', 'awaiting_approval'].includes(item.status))
        if (!running)
          return null
        return agent.injectSteering(conversationId, text)
      },
      approvePending: async (conversationId) => {
        const task = agent.listActiveTasks(conversationId).find(item => item.status === 'awaiting_approval' && item.pendingAction)
        if (task?.pendingAction)
          agent.approvePendingAction({ taskId: task.taskId, actionId: task.pendingAction.actionId })
      },
      denyPending: async (conversationId) => {
        const task = agent.listActiveTasks(conversationId).find(item => item.status === 'awaiting_approval' && item.pendingAction)
        if (task?.pendingAction)
          agent.rejectPendingAction({ taskId: task.taskId, actionId: task.pendingAction.actionId, reason: '通过消息频道拒绝' })
      },
    })
    this.delivery = new ChannelDelivery({ events: core.events, data: core.data, connectors: this.connectors, logger: core.logger })
    this.actionHandler = new ChannelActionHandler({
      data: core.data,
      delivery: this.delivery,
      runtime: this.runtime,
      agent,
      logger: core.logger,
    })
  }

  async initialize() {
    this.delivery.start()
    for (const account of await this.core.data.channelAccountRepository.list()) {
      if (!account.enabled)
        continue
      const connector = this.connectors.get(account.channelType)
      if (!connector)
        continue
      try {
        await this.startAccount(account, connector)
        await this.core.data.channelAccountRepository.updateStatus(account.id, 'connected')
      }
      catch (error) {
        await this.core.data.channelAccountRepository.updateStatus(account.id, 'degraded', error instanceof Error ? error.message : String(error))
        this.core.logger.warn('消息频道连接失败，已隔离本地 Agent', { channelType: account.channelType, error })
      }
    }
  }

  async dispose() { this.delivery.stop(); await Promise.all([...this.connectors.values()].map(connector => connector.stop().catch(() => {}))) }

  /** agent 工具直发附件的宿主能力：定位账号对应 connector 并透传，失败抛给工具层。 */
  async sendAttachment(input: Parameters<ChannelAttachmentSender['send']>[0]): Promise<{ messageId: string }> {
    const account = await this.core.data.channelAccountRepository.getById(input.channelAccountId)
    const connector = this.connectors.get(account.channelType)
    if (!connector)
      throw new Error('频道发送能力不可用')
    return connector.sendAttachment({
      externalChatId: input.externalChatId,
      attachment: input.attachment,
    })
  }

  @Method()
  async list(_input?: AppRpcInput<'channel.list'>): Promise<ChannelAccountView[]> { return (await this.core.data.channelAccountRepository.list()).map(toPublicAccount) }

  @Method()
  async setup(input: AppRpcInput<'channel.setup'>): Promise<ChannelSetupResult> {
    // channel_accounts.channel_type 有唯一索引：每种平台只允许一个频道。
    // 已有频道时引导用户在卡片上重新授权或删除重建，避免撞唯一约束后抛底层 SQL 错误。
    const existing = input.channelAccountId
      ? await this.core.data.channelAccountRepository.getById(input.channelAccountId)
      : await this.core.data.channelAccountRepository.getByType(input.channelType)
    if (!input.channelAccountId && existing)
      throw new Error(`已存在${input.channelType === 'feishu' ? '飞书' : '微信'}频道「${existing.displayName}」。每种平台只支持一个频道，请在该频道上点击「重新授权」，或删除后重新添加。`)
    if (existing && existing.channelType !== input.channelType)
      throw new Error('频道与应用平台不匹配，请重新发起。')
    return input.channelType === 'feishu'
      ? this.setupFeishu(input, existing)
      : this.setupWeixin(input, existing)
  }

  private async setupFeishu(input: AppRpcInput<'channel.setup'>, existing: ChannelAccount | undefined): Promise<ChannelSetupResult> {
    // 重新授权已有频道时，应用 ID 从已保存凭证读取，避免把凭据内容暴露给前端。
    let appId = input.appId
    if (existing) {
      const credential = existing.credentialRef
        ? await this.core.secretStore.resolve({ kind: 'secret_ref', id: existing.credentialRef, scope: 'persistent' })
        : null
      appId = credential ? (JSON.parse(credential) as { appId?: string }).appId : undefined
      if (!appId)
        throw new Error('该频道的凭证不完整，无法重新授权，请删除后重新添加。')
    }

    const account = existing ?? await this.createAccount({ channelType: input.channelType, displayName: input.displayName, defaultWorkspacePath: input.defaultWorkspacePath })
    const setup = this.feishuRegistration.start({
      appName: input.displayName,
      appId,
      onCompleted: async ({ clientId, clientSecret }) => {
        const credential = await this.core.secretStore.saveChannelCredential({ channelAccountId: account.id, value: JSON.stringify({ appId: clientId, appSecret: clientSecret }) })
        // 新建频道默认直接启用；重新授权保持用户当前的启用状态。
        const configured = await this.core.data.channelAccountRepository.upsert({
          ...account,
          displayName: input.displayName.trim(),
          defaultWorkspacePath: input.defaultWorkspacePath,
          credentialRef: credential.id,
          enabled: existing ? account.enabled : true,
          status: 'configured',
          updatedAt: Date.now(),
        })
        const connector = this.connectors.get('feishu')
        if (connector && configured.enabled) {
          try {
            await this.startAccount(configured, connector)
            await this.core.data.channelAccountRepository.updateStatus(account.id, 'connected')
          }
          catch (error) {
            await this.core.data.channelAccountRepository.updateStatus(account.id, 'degraded', error instanceof Error ? error.message : String(error))
            this.core.logger.warn(existing ? '飞书重新授权完成，但 WebSocket 启动失败' : '飞书扫码完成，但 WebSocket 启动失败', { error })
          }
        }
      },
    })
    this.setupAccounts.set(setup.setupId, account.id)
    this.setupChannelTypes.set(setup.setupId, 'feishu')
    return { setupId: setup.setupId, channelType: 'feishu', mode: setup.mode, status: setup.status, verificationUrl: setup.verificationUrl, expiresAt: setup.expiresAt }
  }

  private async setupWeixin(input: AppRpcInput<'channel.setup'>, existing: ChannelAccount | undefined): Promise<ChannelSetupResult> {
    this.core.logger.info('[消息频道] 发起微信扫码配置', {
      channelAccountId: input.channelAccountId,
      reauth: Boolean(existing),
    })
    let localToken: string | undefined
    if (existing) {
      const credential = existing.credentialRef
        ? await this.core.secretStore.resolve({ kind: 'secret_ref', id: existing.credentialRef, scope: 'persistent' })
        : null
      localToken = credential ? parseWeixinCredential(credential).botToken : undefined
      if (!localToken)
        throw new Error('该频道的凭证不完整，无法重新授权，请删除后重新添加。')
    }

    const account = existing ?? await this.createAccount({ channelType: 'weixin', displayName: input.displayName, defaultWorkspacePath: input.defaultWorkspacePath })
    const setup = this.weixinRegistration.start({
      localToken,
      onCompleted: async ({ botToken, botId, userId, baseUrl }) => {
        const credential = await this.core.secretStore.saveChannelCredential({ channelAccountId: account.id, value: JSON.stringify({ botToken, botId, userId, baseUrl }) })
        // 新建频道默认直接启用；重新授权保持用户当前的启用状态。
        const configured = await this.core.data.channelAccountRepository.upsert({
          ...account,
          displayName: input.displayName.trim(),
          ownerUserId: userId,
          defaultWorkspacePath: input.defaultWorkspacePath,
          credentialRef: credential.id,
          enabled: existing ? account.enabled : true,
          status: 'configured',
          updatedAt: Date.now(),
        })
        const connector = this.connectors.get('weixin')
        if (connector && configured.enabled) {
          try {
            await this.startAccount(configured, connector)
            await this.core.data.channelAccountRepository.updateStatus(account.id, 'connected')
          }
          catch (error) {
            await this.core.data.channelAccountRepository.updateStatus(account.id, 'degraded', error instanceof Error ? error.message : String(error))
            this.core.logger.warn(existing ? '微信重新授权完成，但长轮询启动失败' : '微信扫码完成，但长轮询启动失败', { error })
          }
        }
      },
    })
    this.setupAccounts.set(setup.setupId, account.id)
    this.setupChannelTypes.set(setup.setupId, 'weixin')
    return {
      setupId: setup.setupId,
      channelType: 'weixin',
      mode: setup.mode,
      status: setup.status,
      verificationUrl: setup.verificationUrl,
      expiresAt: setup.expiresAt,
      verifyCodeRequired: setup.verifyCodeRequired,
    }
  }

  @Method()
  async getSetupStatus(input: AppRpcInput<'channel.getSetupStatus'>) {
    if (this.setupChannelTypes.get(input.setupId) === 'weixin') {
      const setup = this.weixinRegistration.get(input.setupId, input.verifyCode)
      if (!setup)
        throw new Error('扫码会话不存在或已过期')
      const accountId = this.setupAccounts.get(input.setupId)
      const account = accountId && setup.status === 'completed' ? await this.core.data.channelAccountRepository.getById(accountId).catch(() => undefined) : undefined
      return {
        setupId: setup.setupId,
        channelType: 'weixin' as const,
        mode: setup.mode,
        status: setup.status,
        verificationUrl: setup.verificationUrl,
        expiresAt: setup.expiresAt,
        error: setup.error,
        verifyCodeRequired: setup.verifyCodeRequired,
        account: account ? toPublicAccount(account) : undefined,
      }
    }
    const setup = this.feishuRegistration.get(input.setupId)
    if (!setup)
      throw new Error('扫码会话不存在或已过期')
    const accountId = this.setupAccounts.get(input.setupId)
    const account = accountId && setup.status === 'completed' ? await this.core.data.channelAccountRepository.getById(accountId).catch(() => undefined) : undefined
    return { ...setup, channelType: 'feishu' as const, account: account ? toPublicAccount(account) : undefined }
  }

  @Method()
  async disconnect(input: AppRpcInput<'channel.disconnect'>): Promise<ChannelAccountView> {
    const account = await this.core.data.channelAccountRepository.getById(input.id)
    await this.connectors.get(account.channelType)?.stop().catch(() => undefined)
    await this.core.secretStore.deleteChannelCredential(input.id)
    return toPublicAccount(await this.core.data.channelAccountRepository.upsert({ ...account, credentialRef: '', enabled: false, status: 'disconnected', updatedAt: Date.now() }))
  }

  @Method()
  async create(input: AppRpcInput<'channel.create'>): Promise<ChannelAccountView> {
    return toPublicAccount(await this.createAccount(input))
  }

  private async createAccount(input: { channelType: ChannelType, displayName: string, credential?: string, defaultWorkspacePath: string }): Promise<ChannelAccount> {
    const id = `channel-${randomUUID()}`
    const secret = input.credential ? await this.core.secretStore.saveChannelCredential({ channelAccountId: id, value: input.credential }) : undefined
    const now = Date.now()
    return this.core.data.channelAccountRepository.upsert({ id, channelType: input.channelType, displayName: input.displayName.trim(), credentialRef: secret?.id ?? '', defaultWorkspacePath: input.defaultWorkspacePath, permissionMode: 'hybrid', enabled: false, status: 'connecting', createdAt: now, updatedAt: now })
  }

  @Method()
  async update(input: AppRpcInput<'channel.update'>): Promise<ChannelAccountView> {
    const current = await this.core.data.channelAccountRepository.getById(input.id)
    const credentialRef = input.credential === undefined ? current.credentialRef : (await this.core.secretStore.saveChannelCredential({ channelAccountId: input.id, value: input.credential })).id
    return toPublicAccount(await this.core.data.channelAccountRepository.upsert({ ...current, displayName: input.displayName?.trim() ?? current.displayName, credentialRef, defaultWorkspacePath: input.defaultWorkspacePath === undefined ? current.defaultWorkspacePath : input.defaultWorkspacePath, updatedAt: Date.now() }))
  }

  @Method()
  async delete(input: AppRpcInput<'channel.delete'>): Promise<null> {
    const account = await this.core.data.channelAccountRepository.getById(input.id)
    await this.connectors.get(account.channelType)?.stop().catch(() => undefined)
    await this.core.secretStore.deleteChannelCredential(input.id)
    await this.core.data.channelAccountRepository.delete(input.id)
    return null
  }

  @Method()
  listPairings(input: AppRpcInput<'channel.listPairings'>) { return this.core.data.channelPairingRepository.listPending(input.channelAccountId) }

  @Method()
  listPairingRequests(input: AppRpcInput<'channel.listPairingRequests'>) { return this.core.data.channelPairingRepository.listPending(input.channelAccountId) }

  @Method()
  approvePairing(input: AppRpcInput<'channel.approvePairing'>) { return this.core.data.channelPairingRepository.updateStatus(input.id, 'authorized', Date.now()) }

  @Method()
  revokePairing(input: AppRpcInput<'channel.revokePairing'>) { return this.core.data.channelPairingRepository.updateStatus(input.id, 'revoked') }

  @Method()
  rejectPairing(input: AppRpcInput<'channel.rejectPairing'>) { return this.core.data.channelPairingRepository.updateStatus(input.id, 'revoked') }

  @Method()
  getStatus(input: AppRpcInput<'channel.getStatus'>) { const connector = this.connectors.get(input.channelType); return connector?.getStatus() ?? { status: 'disconnected' as const } }

  @Method()
  async enable(input: AppRpcInput<'channel.enable'>) {
    const account = await this.core.data.channelAccountRepository.updateEnabled(input.id, true)
    const connector = this.connectors.get(account.channelType)
    if (connector) {
      try {
        await this.startAccount(account, connector)
        await this.core.data.channelAccountRepository.updateStatus(input.id, 'connected')
        return { id: account.id, enabled: true, status: 'connected' as const }
      }
      catch (error) {
        await this.core.data.channelAccountRepository.updateStatus(input.id, 'degraded', error instanceof Error ? error.message : String(error))
      }
    }
    await this.core.data.channelAccountRepository.updateStatus(input.id, 'configured')
    return { id: account.id, enabled: true, status: 'configured' as const }
  }

  @Method()
  async disable(input: AppRpcInput<'channel.disable'>) {
    const account = await this.core.data.channelAccountRepository.updateEnabled(input.id, false)
    await this.connectors.get(account.channelType)?.stop().catch(() => undefined)
    await this.core.data.channelAccountRepository.updateStatus(input.id, 'disconnected')
    return { id: account.id, enabled: false, status: 'disconnected' as const }
  }

  private async startAccount(account: ChannelAccount, connector: ChannelConnector): Promise<void> {
    const credential = account.credentialRef ? await this.core.secretStore.resolve({ kind: 'secret_ref', id: account.credentialRef, scope: 'persistent' }) : null
    if (!credential)
      throw new Error('频道凭证不存在或已失效')
    await connector.start({
      channelAccountId: account.id,
      credential,
      onInbound: async (event) => {
        this.core.logger.info('[消息频道] 收到频道私聊消息', { channelType: event.channelType, channelAccountId: event.channelAccountId, externalChatId: event.externalChatId, externalMessageId: event.externalMessageId })
        const typing = await this.setTyping(connector, event.externalMessageId, true)
        let keepTyping = false
        try {
          const result = await this.runtime.handleInbound(event)
          if (result.kind === 'pairing-required') {
            this.core.logger.info('[消息频道] 已创建待配对请求', { channelAccountId: event.channelAccountId, externalUserId: event.externalUserId })
            await this.delivery.deliverResponse(event, result.message)
          }
          else if (result.kind === 'duplicate') {
            this.core.logger.info('[消息频道] 忽略重复消息', { externalMessageId: event.externalMessageId })
            keepTyping = typing?.changed === false
          }
          else if (result.kind === 'command') {
            await this.delivery.deliverCommand(event, result.conversationId ?? '', result.message, result.presentation)
          }
          else if (result.kind === 'configuration-required') {
            await this.delivery.deliverResponse(event, result.message)
          }
          else if (result.kind === 'turn') {
            keepTyping = true
          }
        }
        catch (error) {
          this.core.logger.warn('[消息频道] 处理入站消息失败', { channelAccountId: event.channelAccountId, externalMessageId: event.externalMessageId, error })
          await this.delivery.deliverResponse(event, `处理消息失败：${error instanceof Error ? error.message : String(error)}`)
        }
        finally {
          if (!keepTyping)
            await this.setTyping(connector, event.externalMessageId, false)
        }
      },
      onAction: event => this.handleAction(event),
    })
  }

  private async handleAction(event: ChannelActionEvent): Promise<ChannelActionResult> {
    return this.actionHandler.handle(event)
  }

  private async setTyping(connector: ChannelConnector, externalMessageId: string, typing: boolean) {
    try {
      return await connector.setTyping?.({ externalMessageId, typing })
    }
    catch (error) {
      this.core.logger.warn('[消息频道] 更新 typing 状态失败', { externalMessageId, typing, error })
      return undefined
    }
  }
}

function toPublicAccount(account: ChannelAccount): ChannelAccountView {
  const { credentialRef, ...publicAccount } = account
  return { ...publicAccount, hasCredential: Boolean(credentialRef) }
}
