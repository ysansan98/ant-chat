import type { AgentTaskSnapshot, ApprovePendingActionOptions, CancelTaskOptions, RejectPendingActionOptions } from '@ant-chat/shared'
import type { AppDataContext } from '../data'
import type { SystemLogger } from '../systemLogger'
import type { ChannelActionEvent, ChannelActionResult } from './channelConnector'
import type { ChannelDelivery } from './channelDelivery'
import type { ChannelRuntime } from './channelRuntime'

export interface ChannelActionHandlerDeps {
  data: Pick<AppDataContext, 'channelReceiptRepository' | 'channelPairingRepository' | 'channelSessionRepository'>
  delivery: Pick<ChannelDelivery, 'resolveAction' | 'claimAction'>
  runtime: Pick<ChannelRuntime, 'selectModel' | 'selectPermissionMode'>
  agent: {
    listActiveTasks: (conversationId?: string) => AgentTaskSnapshot[]
    cancelTask: (options: CancelTaskOptions) => void
    approvePendingAction: (options: ApprovePendingActionOptions) => void
    rejectPendingAction: (options: RejectPendingActionOptions) => void
    rejectSecretRequest: (options: { requestId: string, reason?: string }) => void
  }
  logger?: Pick<SystemLogger, 'warn'>
}

/**
 * 卡片操作裁决：配对/会话/幂等/task 归属校验 + 六路 action 分支。
 * ChannelModule 只做装配与 RPC 转译，本模块是卡片操作的测试面。
 */
export class ChannelActionHandler {
  constructor(private readonly deps: ChannelActionHandlerDeps) {}

  async handle(event: ChannelActionEvent): Promise<ChannelActionResult> {
    try {
      const receiptKey = `card-action:${event.externalEventId}`
      if (await this.deps.data.channelReceiptRepository.get(event.channelAccountId, receiptKey, 'inbound'))
        return { status: 'success', message: '该操作已处理。' }
      const pairing = await this.deps.data.channelPairingRepository.get(event.channelAccountId, event.externalUserId)
      if (pairing?.status !== 'authorized')
        return { status: 'error', message: '当前频道身份未获授权。' }
      const session = await this.deps.data.channelSessionRepository.get(event.channelAccountId, event.externalChatId)
      if (!session)
        return { status: 'error', message: '频道会话已失效，请重新发送消息。' }
      const action = this.deps.delivery.resolveAction(event)
      if (!action)
        return { status: 'error', message: '卡片操作无效或已过期。' }

      let message: string
      let updatedContent: ChannelActionResult['updatedContent']
      if (action.kind === 'model.select') {
        if (action.conversationId !== session.activeConversationId)
          return { status: 'error', message: '这张模型卡片已过期，请重新发送 /models。' }
        const selected = event.formValues?.model
        const model = selected ? action.options[selected] : undefined
        if (!model)
          return { status: 'error', message: '请选择一个可用模型。' }
        message = await this.deps.runtime.selectModel(action.conversationId, model.providerId, model.modelId)
        this.deps.delivery.claimAction(event)
        updatedContent = { kind: 'notice', title: '模型已切换', text: message, tone: 'success' }
      }
      else if (action.kind === 'permission-mode.select') {
        if (action.conversationId !== session.activeConversationId)
          return { status: 'error', message: '这张权限模式卡片已过期，请重新发送 /mode。' }
        const selected = event.formValues?.permissionMode
        const permissionMode = selected ? action.options[selected] : undefined
        if (!permissionMode)
          return { status: 'error', message: '请选择一个可用权限模式。' }
        message = await this.deps.runtime.selectPermissionMode(event.channelAccountId, permissionMode)
        this.deps.delivery.claimAction(event)
        updatedContent = { kind: 'notice', title: '权限模式已切换', text: message, tone: 'success' }
      }
      else if (action.kind === 'secret.reject') {
        const task = this.requireActionTask(session.activeConversationId, action.executionId, event)
        if (task.userMessageId !== action.executionId)
          return { status: 'error', message: '敏感信息请求与当前任务不匹配。' }
        this.deps.delivery.claimAction(event)
        this.deps.agent.rejectSecretRequest({ requestId: action.requestId, reason: '用户通过飞书拒绝提供敏感信息' })
        message = '已拒绝提供敏感信息。'
      }
      else if (action.kind === 'task.cancel') {
        this.requireActionTask(session.activeConversationId, action.taskId, event)
        this.deps.delivery.claimAction(event)
        this.deps.agent.cancelTask({ taskId: action.taskId })
        message = '已请求停止当前任务。'
      }
      else {
        const task = this.requireActionTask(session.activeConversationId, action.taskId, event)
        if (task.pendingAction?.actionId !== action.actionId)
          return { status: 'error', message: '审批操作已处理或已过期。' }
        this.deps.delivery.claimAction(event)
        if (action.kind === 'approval.approve') {
          this.deps.agent.approvePendingAction({ taskId: action.taskId, actionId: action.actionId })
          message = '已批准，本次任务将继续执行。'
        }
        else {
          this.deps.agent.rejectPendingAction({ taskId: action.taskId, actionId: action.actionId, reason: '用户通过飞书拒绝' })
          message = '已拒绝该操作。'
        }
      }

      await this.deps.data.channelReceiptRepository.create({
        channelAccountId: event.channelAccountId,
        externalChatId: event.externalChatId,
        externalMessageId: receiptKey,
        localMessageId: event.externalMessageId,
        direction: 'inbound',
        status: 'received',
      })
      return { status: 'success', message, ...(updatedContent ? { updatedContent } : {}) }
    }
    catch (error) {
      this.deps.logger?.warn('[消息频道] 处理卡片操作失败', { externalEventId: event.externalEventId, error })
      return { status: 'error', message: error instanceof Error ? error.message : '卡片操作失败。' }
    }
  }

  private requireActionTask(conversationId: string, taskIdOrExecutionId: string, event: ChannelActionEvent): AgentTaskSnapshot {
    const task = this.deps.agent.listActiveTasks(conversationId).find(item => item.taskId === taskIdOrExecutionId || item.userMessageId === taskIdOrExecutionId)
    if (!task || task.turnSource?.type !== 'channel'
      || task.turnSource.channelAccountId !== event.channelAccountId
      || task.turnSource.externalUserId !== event.externalUserId
      || task.turnSource.externalChatId !== event.externalChatId
      || !['feishu', 'weixin'].includes(task.turnSource.channelType)) {
      throw new Error('任务不存在、已结束或不属于当前频道。')
    }
    return task
  }
}
