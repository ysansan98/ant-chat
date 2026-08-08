import { describe, expect, it, vi } from 'vitest'
import type { AgentTaskSnapshot } from '@ant-chat/shared'
import type { ChannelActionEvent } from '../channelConnector'
import { ChannelActionHandler } from '../channelActionHandler'

function createHarness() {
  const data = {
    channelReceiptRepository: {
      get: vi.fn(async (): Promise<unknown> => undefined),
      create: vi.fn(async (input: object) => ({ id: 'receipt-1', ...input })),
    },
    channelPairingRepository: {
      get: vi.fn(async (): Promise<unknown> => ({ id: 'pair-1', channelAccountId: 'a1', externalUserId: 'u1', externalDisplayName: '用户', status: 'authorized' as const, requestedAt: 1 })),
    },
    channelSessionRepository: {
      get: vi.fn(async () => ({ channelAccountId: 'a1', externalChatId: 'chat-1', activeConversationId: 'c1', currentWorkspacePath: '/workspace', createdAt: 1, updatedAt: 1 })),
    },
  }
  const delivery = {
    resolveAction: vi.fn(),
    claimAction: vi.fn(() => true),
  }
  const runtime = {
    selectModel: vi.fn(async () => '已切换模型：模型一'),
    selectPermissionMode: vi.fn(async () => '已切换权限模式：自动审查'),
  }
  const agent = {
    listActiveTasks: vi.fn((_conversationId?: string): AgentTaskSnapshot[] => []),
    cancelTask: vi.fn(),
    approvePendingAction: vi.fn(),
    rejectPendingAction: vi.fn(),
    rejectSecretRequest: vi.fn(),
  }
  const handler = new ChannelActionHandler({
    data: data as never,
    delivery: delivery as never,
    runtime,
    agent,
    logger: { warn: vi.fn() },
  })
  return { handler, data, delivery, runtime, agent }
}

const baseEvent: ChannelActionEvent = {
  channelAccountId: 'a1',
  externalEventId: 'evt-1',
  externalUserId: 'u1',
  externalChatId: 'chat-1',
  externalMessageId: 'msg-1',
  actionToken: 'tok-1',
}

describe('channelActionHandler 卡片操作裁决', () => {
  it('重复外部事件按幂等回执直接返回已处理', async () => {
    const { handler, data, delivery } = createHarness()
    data.channelReceiptRepository.get = vi.fn(async (): Promise<unknown> => ({ id: 'r1', channelAccountId: 'a1', externalChatId: 'chat-1', externalMessageId: 'card-action:evt-1', direction: 'inbound' as const, status: 'received' as const, createdAt: 1, updatedAt: 1 }))

    const result = await handler.handle(baseEvent)

    expect(result).toEqual({ status: 'success', message: '该操作已处理。' })
    expect(delivery.resolveAction).not.toHaveBeenCalled()
  })

  it('未授权身份拒绝执行并提示配对', async () => {
    const { handler, data } = createHarness()
    data.channelPairingRepository.get = vi.fn(async (): Promise<unknown> => ({ id: 'pair-1', channelAccountId: 'a1', externalUserId: 'u2', externalDisplayName: '新用户', status: 'pending' as const, requestedAt: 1, expiresAt: 1 }))

    const result = await handler.handle({ ...baseEvent, externalUserId: 'u2' })

    expect(result).toEqual({ status: 'error', message: '当前频道身份未获授权。' })
  })

  it('模型选择卡片成功执行并写幂等回执', async () => {
    const { handler, data, delivery, runtime } = createHarness()
    delivery.resolveAction.mockReturnValue({
      kind: 'model.select',
      conversationId: 'c1',
      options: { 'option-1': { providerId: 'p1', modelId: 'm1' } },
    })
    const event = { ...baseEvent, formValues: { model: 'option-1' } }

    const result = await handler.handle(event)

    expect(runtime.selectModel).toHaveBeenCalledWith('c1', 'p1', 'm1')
    expect(delivery.claimAction).toHaveBeenCalledWith(event)
    expect(data.channelReceiptRepository.create).toHaveBeenCalledWith(expect.objectContaining({ externalMessageId: 'card-action:evt-1', localMessageId: 'msg-1' }))
    expect(result).toEqual({
      status: 'success',
      message: '已切换模型：模型一',
      updatedContent: { kind: 'notice', title: '模型已切换', text: '已切换模型：模型一', tone: 'success' },
    })
  })

  it('模型选择卡片指向过期会话时拒绝执行', async () => {
    const { handler, delivery } = createHarness()
    delivery.resolveAction.mockReturnValue({
      kind: 'model.select',
      conversationId: 'c-other',
      options: { 'option-1': { providerId: 'p1', modelId: 'm1' } },
    })

    const result = await handler.handle({ ...baseEvent, formValues: { model: 'option-1' } })

    expect(result).toEqual({ status: 'error', message: '这张模型卡片已过期，请重新发送 /models。' })
    expect(delivery.claimAction).not.toHaveBeenCalled()
  })

  it('审批操作校验 task 归属后执行 approve', async () => {
    const { handler, data, delivery, agent } = createHarness()
    delivery.resolveAction.mockReturnValue({ kind: 'approval.approve', taskId: 't1', actionId: 'act-1' })
    agent.listActiveTasks.mockReturnValue([{
      taskId: 't1',
      userMessageId: 'm1',
      conversationId: 'c1',
      status: 'awaiting_approval',
      workspacePath: '/workspace',
      mode: 'hybrid',
      createdAt: 1,
      updatedAt: 1,
      prompt: '继续',
      turnSource: { type: 'channel', channelType: 'feishu', channelAccountId: 'a1', externalUserId: 'u1', externalChatId: 'chat-1', externalMessageId: 'src-1' },
      pendingAction: { actionId: 'act-1', toolName: 'bash', operationType: 'command', scope: 'workspace', inputPreview: '', createdAt: 1 },
    }])

    const result = await handler.handle(baseEvent)

    expect(agent.approvePendingAction).toHaveBeenCalledWith({ taskId: 't1', actionId: 'act-1' })
    expect(delivery.claimAction).toHaveBeenCalledWith(baseEvent)
    expect(data.channelReceiptRepository.create).toHaveBeenCalled()
    expect(result.status).toBe('success')
  })

  it('task 不属于当前频道身份时拒绝执行', async () => {
    const { handler, delivery, agent } = createHarness()
    delivery.resolveAction.mockReturnValue({ kind: 'approval.approve', taskId: 't1', actionId: 'act-1' })
    agent.listActiveTasks.mockReturnValue([{
      taskId: 't1',
      userMessageId: 'm1',
      conversationId: 'c1',
      status: 'awaiting_approval',
      workspacePath: '/workspace',
      mode: 'hybrid',
      createdAt: 1,
      updatedAt: 1,
      prompt: '继续',
      turnSource: { type: 'channel', channelType: 'weixin', channelAccountId: 'a-other', externalUserId: 'u-other', externalChatId: 'chat-other', externalMessageId: 'src-1' },
      pendingAction: { actionId: 'act-1', toolName: 'bash', operationType: 'command', scope: 'workspace', inputPreview: '', createdAt: 1 },
    }])

    const result = await handler.handle(baseEvent)

    expect(result).toEqual({ status: 'error', message: '任务不存在、已结束或不属于当前频道。' })
    expect(agent.approvePendingAction).not.toHaveBeenCalled()
  })
})
