import type {
  AgentMode,
  AgentPendingAction,
  AgentTaskSnapshot,
  ChannelType,
  IMessage,
  ModelInfo,
  SecretRequest,
  ToolCallContent,
  ToolResultContent,
  VisualizationBlock,
} from '@ant-chat/shared'
import type { AppDataContext } from '../data'
import type { AppRuntimeEventBus } from '../events'
import type { SystemLogger } from '../systemLogger'
import type {
  ChannelActionEvent,
  ChannelAttachment,
  ChannelConnector,
  ChannelExecutionStep,
  ChannelOutboundContent,
} from './channelConnector'
import type { ChannelCommandPresentation, ChannelInboundEvent } from './channelRuntime'
import { randomUUID } from 'node:crypto'

const EXECUTION_UPDATE_INTERVAL_MS = 250

export type ChannelInteractionAction
  = | {
    kind: 'model.select'
    conversationId: string
    options: Record<string, { providerId: string, modelId: string }>
  }
  | {
    kind: 'permission-mode.select'
    conversationId: string
    options: Record<string, AgentMode>
  }
  | { kind: 'approval.approve', taskId: string, actionId: string }
  | { kind: 'approval.reject', taskId: string, actionId: string }
  | { kind: 'secret.reject', requestId: string, executionId: string }
  | { kind: 'task.cancel', taskId: string }

interface ExecutionProjection {
  executionId: string
  taskId?: string
  channelType: ChannelType
  channelAccountId: string
  externalUserId?: string
  externalChatId: string
  model?: ModelInfo
  text: string
  steps: Map<string, ChannelExecutionStep>
  actionTokens: Map<string, string>
  status: AgentTaskSnapshot['status']
  phase?: AgentTaskSnapshot['executionPhase']
  pendingAction?: AgentPendingAction
  visualization?: { title: string, summary: string }
  secretRequest?: SecretRequest
  lastPublishedAt?: number
  lastSentText?: string
  lastSentPendingActionId?: string
  attachments?: ChannelAttachment[]
  timer?: ReturnType<typeof setTimeout>
}

interface RegisteredAction {
  channelAccountId: string
  externalUserId: string
  externalChatId: string
  action: ChannelInteractionAction
}

export class ChannelDelivery {
  private unsubscribers: Array<() => void> = []
  private readonly executions = new Map<string, ExecutionProjection>()
  private readonly actions = new Map<string, RegisteredAction>()
  private readonly queues = new Map<string, Promise<void>>()
  private readonly supportsUpdateByType = new Map<ChannelType, boolean>()

  constructor(private readonly deps: {
    events: AppRuntimeEventBus
    data: AppDataContext
    connectors: Map<ChannelType, ChannelConnector>
    logger?: Pick<SystemLogger, 'warn'>
  }) {
    for (const [type, connector] of this.deps.connectors) {
      this.supportsUpdateByType.set(type, connector.capabilities.supportsUpdate)
    }
  }

  private supportsUpdate(channelType: ChannelType): boolean {
    return this.supportsUpdateByType.get(channelType) ?? false
  }

  start(): void {
    this.unsubscribers.push(this.deps.events.on('message:updated', (event) => {
      if (event.message.turnId)
        this.enqueue(event.message.turnId, () => this.handleMessage(event.message))
    }))
    this.unsubscribers.push(this.deps.events.on('agent:task-updated', (event) => {
      this.enqueue(event.task.userMessageId, () => this.handleTaskUpdate(event.task))
    }))
    this.unsubscribers.push(this.deps.events.on('agent:secret-requested', (event) => {
      this.enqueue(event.request.runId, () => this.handleSecretRequest(event.request))
    }))
  }

  stop(): void {
    this.unsubscribers.forEach(unsubscribe => unsubscribe())
    this.unsubscribers = []
    for (const execution of this.executions.values()) {
      if (execution.timer)
        clearTimeout(execution.timer)
    }
    this.executions.clear()
    this.actions.clear()
    this.queues.clear()
  }

  deliverResponse(event: ChannelInboundEvent, text: string): Promise<void> {
    return this.publish(event.channelAccountId, event.externalChatId, event.externalMessageId, {
      kind: 'text',
      text,
    })
  }

  deliverCommand(event: ChannelInboundEvent, conversationId: string, message: string, presentation?: ChannelCommandPresentation): Promise<void> {
    if (!presentation)
      return this.deliverResponse(event, message)
    if (presentation.kind === 'model-selection') {
      // 纯文本平台（微信）无法渲染选择卡片：直接发带序号的文本列表，用户用 /model <序号> 切换。
      if (!this.supportsUpdate(event.channelType)) {
        const lines = [...message.split('\n'), '回复 /model <序号> 切换。']
        return this.deliverResponse(event, lines.join('\n'))
      }
      const options = Object.fromEntries(presentation.models.map(model => [
        randomUUID(),
        { providerId: model.providerId, modelId: model.modelId },
      ]))
      const optionEntries = Object.entries(options)
      return this.publish(event.channelAccountId, event.externalChatId, event.externalMessageId, {
        kind: 'model-selection',
        title: '选择模型',
        token: this.registerAction(event.channelAccountId, event.externalUserId, event.externalChatId, {
          kind: 'model.select',
          conversationId,
          options,
        }),
        models: presentation.models.map((model, index) => ({
          label: model.label,
          selected: model.selected,
          value: optionEntries[index][0],
        })),
      })
    }
    if (presentation.kind === 'permission-mode-selection' && !this.supportsUpdate(event.channelType)) {
      const lines = presentation.modes.map((mode, index) => `${mode.selected ? '✓ ' : ''}${index + 1}. ${mode.label}`)
      lines.push('回复 /mode <序号> 切换。')
      return this.deliverResponse(event, lines.join('\n'))
    }
    const options = Object.fromEntries(presentation.modes.map(mode => [randomUUID(), mode.value]))
    const optionEntries = Object.entries(options)
    return this.publish(event.channelAccountId, event.externalChatId, event.externalMessageId, {
      kind: 'permission-mode-selection',
      title: '选择权限模式',
      token: this.registerAction(event.channelAccountId, event.externalUserId, event.externalChatId, {
        kind: 'permission-mode.select',
        conversationId,
        options,
      }),
      modes: presentation.modes.map((mode, index) => ({
        label: mode.label,
        selected: mode.selected,
        value: optionEntries[index][0],
      })),
    })
  }

  resolveAction(event: ChannelActionEvent): ChannelInteractionAction | undefined {
    const registered = this.actions.get(event.actionToken)
    if (!registered
      || registered.channelAccountId !== event.channelAccountId
      || registered.externalUserId !== event.externalUserId
      || registered.externalChatId !== event.externalChatId) {
      return undefined
    }
    return registered.action
  }

  claimAction(event: ChannelActionEvent): boolean {
    if (!this.resolveAction(event))
      return false
    return this.actions.delete(event.actionToken)
  }

  private async handleMessage(message: IMessage): Promise<void> {
    if (!message.turnId || !['assistant', 'tool'].includes(message.role))
      return
    const projection = await this.getOrCreateExecution(message.turnId)
    if (!projection)
      return
    if (message.role === 'assistant') {
      projection.model = message.modelInfo
      const text = message.content
        .filter((block): block is { type: 'text', text: string } => block.type === 'text')
        .map(block => block.text)
        .join('\n')
        .trim()
      if (text)
        projection.text = text
      projection.attachments = await this.collectAttachments(message.content)
      for (const block of message.content) {
        if (block.type === 'tool-call')
          this.applyToolCall(projection, block)
        if (block.type === 'visualization')
          this.applyVisualization(projection, block)
      }
    }
    else {
      for (const block of message.content) {
        if (block.type === 'tool-result')
          this.applyToolResult(projection, block)
      }
    }
    await this.scheduleExecution(projection)
  }

  /** 收集 assistant 附件块并解析字节：块自带 data 优先，否则从 file_id 读取。 */
  private async collectAttachments(content: IMessage['content']): Promise<ChannelAttachment[] | undefined> {
    const attachments: ChannelAttachment[] = []
    for (const block of content) {
      if (block.type !== 'image-block' && block.type !== 'document' && block.type !== 'file')
        continue
      if (block.source.type !== 'file_id') {
        // url 来源需要额外下载器，本次不做，跳过并保留日志。
        this.deps.logger?.warn(`[消息频道] 跳过 url 来源附件块：${block.type}`)
        continue
      }
      const data = block.data ?? await this.deps.data.loadAttachmentData(block.source.file_id)
      if (!data) {
        this.deps.logger?.warn(`[消息频道] 附件数据缺失，跳过：${block.source.file_id}`)
        continue
      }
      const name = block.type === 'file'
        ? block.filename ?? block.name ?? 'file'
        : block.name ?? block.type
      attachments.push({
        name,
        mediaType: block.media_type ?? (block.type === 'image-block' ? 'image/jpeg' : 'application/octet-stream'),
        data,
        size: block.size,
        kind: block.type === 'image-block' ? 'image' : block.type,
      })
    }
    return attachments.length > 0 ? attachments : undefined
  }

  private async handleTaskUpdate(task: AgentTaskSnapshot): Promise<void> {
    if (task.turnSource?.type !== 'channel')
      return
    const projection: ExecutionProjection = this.executions.get(task.userMessageId) ?? {
      executionId: task.userMessageId,
      channelType: task.turnSource.channelType,
      channelAccountId: task.turnSource.channelAccountId,
      externalUserId: task.turnSource.externalUserId,
      externalChatId: task.turnSource.externalChatId,
      text: '',
      steps: new Map(),
      actionTokens: new Map(),
      status: task.status,
    }
    projection.taskId = task.taskId
    projection.externalUserId = task.turnSource.externalUserId
    projection.status = task.status
    projection.phase = task.executionPhase
    projection.pendingAction = task.pendingAction
    projection.secretRequest = task.status === 'running' ? projection.secretRequest : undefined
    if (task.status === 'failed')
      projection.text = task.errorMessage ?? task.summary ?? projection.text
    else if (task.status === 'success' && !projection.text)
      projection.text = task.summary ?? projection.text
    const settled = ['success', 'failed', 'cancelled'].includes(task.status)
    if (settled && !projection.model)
      projection.model = await this.getConversationModel(task.conversationId)
    this.executions.set(task.userMessageId, projection)
    if (projection.model)
      await this.flushExecution(projection, settled || task.status === 'awaiting_approval')
    if (settled) {
      await this.deps.connectors.get(task.turnSource.channelType)?.setTyping?.({
        externalMessageId: task.turnSource.externalMessageId,
        typing: false,
      }).catch(() => undefined)
    }
  }

  private async handleSecretRequest(request: SecretRequest): Promise<void> {
    const projection = this.executions.get(request.runId)
    if (!projection)
      return
    projection.secretRequest = request
    if (projection.model)
      await this.flushExecution(projection, true)
  }

  private async scheduleExecution(projection: ExecutionProjection): Promise<void> {
    if (!projection.model)
      return
    // 纯文本平台（微信）没有可更新消息：流式中间态不发送，只等 handleTaskUpdate 终态发一次。
    if (!this.supportsUpdate(projection.channelType))
      return
    const now = Date.now()
    const elapsed = now - (projection.lastPublishedAt ?? 0)
    if (!projection.lastPublishedAt || elapsed >= EXECUTION_UPDATE_INTERVAL_MS) {
      await this.flushExecution(projection)
      return
    }
    if (projection.timer)
      return
    projection.timer = setTimeout(() => {
      projection.timer = undefined
      this.enqueue(projection.executionId, () => this.flushExecution(projection))
    }, EXECUTION_UPDATE_INTERVAL_MS - elapsed)
  }

  private async flushExecution(projection: ExecutionProjection, immediate = false): Promise<void> {
    if (!projection.model)
      return
    if (immediate && projection.timer) {
      clearTimeout(projection.timer)
      projection.timer = undefined
    }
    const actions = this.executionActions(projection)
    const supportsUpdate = this.supportsUpdate(projection.channelType)
    let text = projection.text
    if (projection.secretRequest) {
      text = [
        projection.text,
        `需要敏感信息：${projection.secretRequest.label}`,
        projection.secretRequest.reason,
        '为避免密码或 Token 经第三方平台传输，请在 Ant Chat 桌面端完成输入。',
      ].filter(Boolean).join('\n\n')
    }
    else if (!supportsUpdate && projection.pendingAction) {
      // 纯文本平台没有可更新的审批卡，把审批信息拼进正文，用户可回复 /approve 或 /deny。
      text = [
        projection.text,
        `需要审批：${projection.pendingAction.toolName}`,
        projection.pendingAction.inputPreview,
        '回复 /approve 批准，/deny 拒绝。',
      ].filter(Boolean).join('\n\n')
    }
    if (!supportsUpdate) {
      // 纯文本平台（微信）没有可更新消息：只在终态或有操作时才发，
      // 避免运行中空状态和重复文本刷屏。
      const actionable = Boolean(projection.pendingAction || projection.secretRequest)
      const settled = ['success', 'failed', 'cancelled'].includes(projection.status)
      if (!actionable && !settled)
        return
      if (!text.trim() && !projection.attachments?.length)
        return
      // 终态只发一次；secret 提示重复触发时再发以便用户看到。
      if (!actionable && projection.lastSentText === text)
        return
      // 同一审批只推一次，task-updated 重复触发时不能刷屏。
      if (projection.pendingAction && projection.lastSentPendingActionId === projection.pendingAction.actionId)
        return
    }
    await this.publish(
      projection.channelAccountId,
      projection.externalChatId,
      projection.executionId,
      {
        kind: 'execution',
        executionId: projection.executionId,
        status: projection.status,
        phase: projection.phase,
        text,
        model: projection.model,
        steps: [...projection.steps.values()],
        pendingAction: projection.pendingAction,
        visualization: projection.visualization,
        actions,
        ...(projection.attachments ? { attachments: projection.attachments } : {}),
      },
    )
    projection.lastSentText = text
    if (projection.pendingAction)
      projection.lastSentPendingActionId = projection.pendingAction.actionId
    projection.lastPublishedAt = Date.now()
  }

  private executionActions(projection: ExecutionProjection) {
    if (projection.pendingAction) {
      return [
        {
          label: '仅本次批准',
          style: 'primary' as const,
          token: this.registerExecutionAction(projection, `approve:${projection.pendingAction.actionId}`, {
            kind: 'approval.approve',
            taskId: projection.taskId!,
            actionId: projection.pendingAction.actionId,
          }),
        },
        {
          label: '拒绝',
          style: 'danger' as const,
          token: this.registerExecutionAction(projection, `reject:${projection.pendingAction.actionId}`, {
            kind: 'approval.reject',
            taskId: projection.taskId!,
            actionId: projection.pendingAction.actionId,
          }),
        },
      ]
    }
    if (projection.secretRequest) {
      return [{
        label: '拒绝提供',
        style: 'danger' as const,
        token: this.registerExecutionAction(projection, `secret:${projection.secretRequest.requestId}`, {
          kind: 'secret.reject',
          requestId: projection.secretRequest.requestId,
          executionId: projection.executionId,
        }),
      }]
    }
    if (projection.status === 'running' && projection.taskId) {
      return [{
        label: '停止任务',
        style: 'danger' as const,
        token: this.registerExecutionAction(projection, `cancel:${projection.taskId}`, {
          kind: 'task.cancel',
          taskId: projection.taskId,
        }),
      }]
    }
    return undefined
  }

  private async getOrCreateExecution(executionId: string): Promise<ExecutionProjection | undefined> {
    const existing = this.executions.get(executionId)
    if (existing)
      return existing
    const origin = await this.deps.data.messageRepository.getById(executionId).catch(() => undefined)
    if (!origin?.originType || origin.originType === 'local' || !origin.originChannelAccountId || !origin.originExternalChatId)
      return undefined
    const projection: ExecutionProjection = {
      executionId,
      channelType: origin.originType,
      channelAccountId: origin.originChannelAccountId,
      externalChatId: origin.originExternalChatId,
      text: '',
      steps: new Map(),
      actionTokens: new Map(),
      status: 'running',
    }
    this.executions.set(executionId, projection)
    return projection
  }

  private applyToolCall(projection: ExecutionProjection, block: ToolCallContent): void {
    projection.steps.set(block.toolCallId, {
      id: block.toolCallId,
      label: block.toolName,
      status: block.executeState === 'completed' ? 'success' : 'running',
    })
  }

  private applyToolResult(projection: ExecutionProjection, block: ToolResultContent): void {
    const previous = projection.steps.get(block.toolCallId)
    projection.steps.set(block.toolCallId, {
      id: block.toolCallId,
      label: previous?.label ?? block.toolName,
      status: block.isError ? 'failed' : 'success',
    })
  }

  private applyVisualization(projection: ExecutionProjection, block: VisualizationBlock): void {
    projection.visualization = { title: block.title, summary: block.summary }
  }

  private async getConversationModel(conversationId: string): Promise<ModelInfo> {
    const conversation = await this.deps.data.conversationRepository.getById(conversationId)
    const provider = this.deps.data.providerSettingsRepository.getAllAvailableModels()
      .find(item => item.id === conversation.settings.providerId)
    const model = provider?.models.find(item => item.id === conversation.settings.modelId)
    return {
      provider: provider?.name ?? conversation.settings.providerId,
      providerId: conversation.settings.providerId,
      model: model?.name ?? conversation.settings.modelId,
    }
  }

  private async publish(channelAccountId: string, externalChatId: string, localMessageId: string, content: ChannelOutboundContent): Promise<void> {
    const connector = this.deps.connectors.get(await this.getChannelType(channelAccountId))
    if (!connector)
      return
    const existing = await this.deps.data.channelReceiptRepository.getOutboundByLocalMessageId(channelAccountId, localMessageId)
    if (existing?.status === 'sent' && connector.capabilities.supportsUpdate) {
      if (content.kind !== 'text')
        await connector.update?.({ externalMessageId: existing.externalMessageId, content })
      return
    }
    // 纯文本平台（微信）没有可更新消息：每次实质内容变化发一条新文本，
    // 并把回执指向最新平台消息 ID，避免唯一约束冲突。
    if (existing?.status === 'sent' && !connector.capabilities.supportsUpdate) {
      const sent = await connector.send({ externalChatId, content })
      await this.deps.data.channelReceiptRepository.updateExternalMessageId(existing.id, sent.externalMessageId)
      return
    }
    if (existing?.status === 'sent')
      return
    const sent = await connector.send({ externalChatId, content })
    await this.deps.data.channelReceiptRepository.create({
      channelAccountId,
      externalChatId,
      externalMessageId: sent.externalMessageId,
      localMessageId,
      direction: 'outbound',
      status: 'sent',
    })
  }

  private async getChannelType(channelAccountId: string): Promise<ChannelType> {
    return (await this.deps.data.channelAccountRepository.getById(channelAccountId)).channelType
  }

  private registerAction(channelAccountId: string, externalUserId: string, externalChatId: string, action: ChannelInteractionAction): string {
    const token = randomUUID()
    this.actions.set(token, { channelAccountId, externalUserId, externalChatId, action })
    return token
  }

  private registerExecutionAction(projection: ExecutionProjection, key: string, action: ChannelInteractionAction): string {
    const existing = projection.actionTokens.get(key)
    if (existing && this.actions.has(existing))
      return existing
    if (!projection.externalUserId)
      throw new Error('频道任务缺少原始操作者，无法创建卡片操作')
    const token = this.registerAction(projection.channelAccountId, projection.externalUserId, projection.externalChatId, action)
    projection.actionTokens.set(key, token)
    return token
  }

  private enqueue(key: string, work: () => Promise<void>): void {
    const previous = this.queues.get(key) ?? Promise.resolve()
    const current = previous.then(work, work).finally(() => {
      if (this.queues.get(key) === current)
        this.queues.delete(key)
    })
    this.queues.set(key, current)
  }
}
