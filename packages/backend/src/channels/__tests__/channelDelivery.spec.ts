import type { AgentTaskSnapshot, IMessage } from '@ant-chat/shared'
import type { ChannelConnector } from '../channelConnector'
import type { ChannelInboundEvent } from '../channelRuntime'
import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import { RuntimeEventBus } from '../../events'
import { ChannelDelivery } from '../channelDelivery'

function createHarness(send = vi.fn(async () => ({ externalMessageId: 'card-1' }))) {
  const events = new RuntimeEventBus()
  let outboundReceipt: Record<string, unknown> | undefined
  const connector = {
    type: 'feishu',
    capabilities: { supportsUpdate: true },
    send,
    update: vi.fn(async () => {}),
    setTyping: vi.fn(async () => ({ changed: true })),
  } as unknown as ChannelConnector
  const data = {
    channelAccountRepository: {
      getById: vi.fn(async () => ({ channelType: 'feishu' })),
    },
    channelReceiptRepository: {
      getOutboundByLocalMessageId: vi.fn(async () => outboundReceipt),
      create: vi.fn(async (input) => {
        outboundReceipt = { id: 'receipt-1', ...input }
        return outboundReceipt
      }),
    },
    messageRepository: {
      getById: vi.fn(async () => ({
        id: 'turn-1',
        role: 'user',
        originType: 'feishu',
        originChannelAccountId: 'account-1',
        originExternalChatId: 'chat-1',
      })),
    },
    loadAttachmentData: vi.fn(async (_fileId: string): Promise<string | null> => null),
    conversationRepository: {
      getById: vi.fn(async () => ({
        id: 'conversation-1',
        settings: { providerId: 'provider-1', modelId: 'model-1' },
      })),
    },
    providerSettingsRepository: {
      getAllAvailableModels: vi.fn(() => [{
        id: 'provider-1',
        name: '服务一',
        models: [{ id: 'model-1', name: '模型一' }],
      }]),
    },
  }
  const delivery = new ChannelDelivery({
    events,
    connectors: new Map([['feishu', connector]]),
    data: data as never,
  })
  delivery.start()
  return { connector, data, delivery, events }
}

describe('频道执行投递', () => {
  it('同一 Turn 的多轮消息只创建一张卡片，后续增量更新并展示实际模型', async () => {
    const { connector, events } = createHarness()
    const source = {
      type: 'channel' as const,
      channelType: 'feishu' as const,
      channelAccountId: 'account-1',
      externalUserId: 'user-1',
      externalChatId: 'chat-1',
      externalMessageId: 'source-message-1',
    }
    events.emit('agent:task-updated', {
      task: {
        taskId: 'task-1',
        userMessageId: 'turn-1',
        conversationId: 'conversation-1',
        status: 'running',
        executionPhase: 'thinking',
        turnSource: source,
      } as AgentTaskSnapshot,
    })
    events.emit('message:updated', {
      message: {
        id: 'assistant-round-1',
        turnId: 'turn-1',
        role: 'assistant',
        status: 'loading',
        modelInfo: { provider: '服务一', providerId: 'provider-1', model: '模型一' },
        content: [{ type: 'text', text: '正在分析' }],
      } as IMessage,
    })

    await vi.waitFor(() => expect(connector.send).toHaveBeenCalledOnce())
    expect(connector.send).toHaveBeenCalledWith({
      externalChatId: 'chat-1',
      content: expect.objectContaining({
        kind: 'execution',
        executionId: 'turn-1',
        text: '正在分析',
        model: { provider: '服务一', providerId: 'provider-1', model: '模型一' },
      }),
    })

    events.emit('message:updated', {
      message: {
        id: 'assistant-round-2',
        turnId: 'turn-1',
        role: 'assistant',
        status: 'success',
        modelInfo: { provider: '服务一', providerId: 'provider-1', model: '模型一' },
        content: [{ type: 'text', text: '最终结果' }],
      } as IMessage,
    })
    events.emit('agent:task-updated', {
      task: {
        taskId: 'task-1',
        userMessageId: 'turn-1',
        conversationId: 'conversation-1',
        status: 'success',
        turnSource: source,
      } as AgentTaskSnapshot,
    })

    await vi.waitFor(() => expect(connector.update).toHaveBeenCalled())
    expect(connector.send).toHaveBeenCalledOnce()
    expect(connector.update).toHaveBeenLastCalledWith({
      externalMessageId: 'card-1',
      content: expect.objectContaining({
        kind: 'execution',
        status: 'success',
        text: '最终结果',
      }),
    })
    expect(connector.setTyping).toHaveBeenCalledWith({
      externalMessageId: 'source-message-1',
      typing: false,
    })
  })

  it('首次建卡尚未完成时也串行处理终态，避免并发创建第二张卡', async () => {
    let releaseSend: (() => void) | undefined
    const send = vi.fn(() => new Promise<{ externalMessageId: string }>((resolve) => {
      releaseSend = () => resolve({ externalMessageId: 'card-1' })
    }))
    const { connector, events } = createHarness(send)
    const source = {
      type: 'channel' as const,
      channelType: 'feishu' as const,
      channelAccountId: 'account-1',
      externalUserId: 'user-1',
      externalChatId: 'chat-1',
      externalMessageId: 'source-message-1',
    }
    events.emit('agent:task-updated', {
      task: {
        taskId: 'task-1',
        userMessageId: 'turn-1',
        conversationId: 'conversation-1',
        status: 'running',
        turnSource: source,
      } as AgentTaskSnapshot,
    })
    events.emit('message:updated', {
      message: {
        id: 'assistant-1',
        turnId: 'turn-1',
        role: 'assistant',
        status: 'loading',
        modelInfo: { provider: '服务一', model: '模型一' },
        content: [{ type: 'text', text: '正在处理' }],
      } as IMessage,
    })
    events.emit('agent:task-updated', {
      task: {
        taskId: 'task-1',
        userMessageId: 'turn-1',
        conversationId: 'conversation-1',
        status: 'success',
        turnSource: source,
      } as AgentTaskSnapshot,
    })

    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce())
    releaseSend?.()
    await vi.waitFor(() => expect(connector.update).toHaveBeenCalledOnce())
    expect(send).toHaveBeenCalledOnce()
    expect(connector.update).toHaveBeenCalledWith({
      externalMessageId: 'card-1',
      content: expect.objectContaining({ kind: 'execution', status: 'success' }),
    })
  })

  it('审批更新原执行卡片并生成一次性操作，不额外发送卡片', async () => {
    const { connector, delivery, events } = createHarness()
    const source = {
      type: 'channel' as const,
      channelType: 'feishu' as const,
      channelAccountId: 'account-1',
      externalUserId: 'user-1',
      externalChatId: 'chat-1',
      externalMessageId: 'source-message-1',
    }
    events.emit('agent:task-updated', {
      task: {
        taskId: 'task-1',
        userMessageId: 'turn-1',
        conversationId: 'conversation-1',
        status: 'running',
        turnSource: source,
      } as AgentTaskSnapshot,
    })
    events.emit('message:updated', {
      message: {
        id: 'assistant-1',
        turnId: 'turn-1',
        role: 'assistant',
        status: 'loading',
        modelInfo: { provider: '服务一', model: '模型一' },
        content: [{ type: 'text', text: '准备执行命令' }],
      } as IMessage,
    })
    await vi.waitFor(() => expect(connector.send).toHaveBeenCalledOnce())

    events.emit('agent:task-updated', {
      task: {
        taskId: 'task-1',
        userMessageId: 'turn-1',
        conversationId: 'conversation-1',
        status: 'awaiting_approval',
        pendingAction: {
          actionId: 'approval-1',
          toolName: 'execute_command',
          operationType: 'command',
          scope: 'outside',
          inputPreview: 'git push',
          createdAt: 1,
        },
        turnSource: source,
      } as AgentTaskSnapshot,
    })

    await vi.waitFor(() => expect(connector.update).toHaveBeenCalled())
    const content = vi.mocked(connector.update!).mock.calls.at(-1)?.[0].content
    expect(content).toMatchObject({
      kind: 'execution',
      status: 'awaiting_approval',
      actions: [
        { label: '仅本次批准', style: 'primary', token: expect.any(String) },
        { label: '拒绝', style: 'danger', token: expect.any(String) },
      ],
    })
    const token = content?.kind === 'execution' ? content.actions?.[0].token : undefined
    expect(delivery.resolveAction({
      channelAccountId: 'account-1',
      externalEventId: 'event-1',
      externalUserId: 'user-1',
      externalChatId: 'chat-1',
      externalMessageId: 'card-1',
      actionToken: token!,
    })).toEqual({
      kind: 'approval.approve',
      taskId: 'task-1',
      actionId: 'approval-1',
    })
    expect(connector.send).toHaveBeenCalledOnce()
  })

  it('普通命令继续发送文本，/models 使用独立模型选择卡片', async () => {
    const { connector, delivery } = createHarness()
    const event: ChannelInboundEvent = {
      channelAccountId: 'account-1',
      channelType: 'feishu',
      externalUserId: 'user-1',
      externalDisplayName: '用户',
      externalChatId: 'chat-1',
      externalMessageId: 'message-1',
      text: '/status',
    }
    await delivery.deliverResponse(event, '当前状态正常')

    expect(connector.send).toHaveBeenCalledWith({
      externalChatId: 'chat-1',
      content: { kind: 'text', text: '当前状态正常' },
    })
  })

  it('/mode 使用权限模式选择卡片并把真实模式隐藏在一次性选项后', async () => {
    const { connector, delivery } = createHarness()
    const event: ChannelInboundEvent = {
      channelAccountId: 'account-1',
      channelType: 'feishu',
      externalUserId: 'user-1',
      externalDisplayName: '用户',
      externalChatId: 'chat-1',
      externalMessageId: 'message-mode',
      text: '/mode',
    }

    await delivery.deliverCommand(event, 'conversation-1', '请选择权限模式。', {
      kind: 'permission-mode-selection',
      modes: [
        { value: 'strict', label: '默认权限', selected: false },
        { value: 'hybrid', label: '自动审查', selected: true },
        { value: 'full_managed', label: '完全访问权限', selected: false },
      ],
    })

    const content = vi.mocked(connector.send).mock.calls[0][0].content
    expect(content).toMatchObject({
      kind: 'permission-mode-selection',
      title: '选择权限模式',
      token: expect.any(String),
      modes: [
        { label: '默认权限', selected: false, value: expect.any(String) },
        { label: '自动审查', selected: true, value: expect.any(String) },
        { label: '完全访问权限', selected: false, value: expect.any(String) },
      ],
    })
    if (content.kind !== 'permission-mode-selection')
      throw new Error('未生成权限模式选择卡片')
    expect(delivery.resolveAction({
      channelAccountId: 'account-1',
      externalEventId: 'event-mode',
      externalUserId: 'user-1',
      externalChatId: 'chat-1',
      externalMessageId: 'card-mode',
      actionToken: content.token,
    })).toEqual({
      kind: 'permission-mode.select',
      conversationId: 'conversation-1',
      options: {
        [content.modes[0].value]: 'strict',
        [content.modes[1].value]: 'hybrid',
        [content.modes[2].value]: 'full_managed',
      },
    })
  })

  it('内置交互工具只更新原执行卡：可视化展示摘要，敏感信息只允许拒绝', async () => {
    const { connector, delivery, events } = createHarness()
    const source = {
      type: 'channel' as const,
      channelType: 'feishu' as const,
      channelAccountId: 'account-1',
      externalUserId: 'user-1',
      externalChatId: 'chat-1',
      externalMessageId: 'source-message-1',
    }
    events.emit('agent:task-updated', {
      task: {
        taskId: 'task-1',
        userMessageId: 'turn-1',
        conversationId: 'conversation-1',
        status: 'running',
        turnSource: source,
      } as AgentTaskSnapshot,
    })
    events.emit('message:updated', {
      message: {
        id: 'assistant-1',
        turnId: 'turn-1',
        role: 'assistant',
        status: 'loading',
        modelInfo: { provider: '服务一', model: '模型一' },
        content: [
          { type: 'text', text: '已生成分析图' },
          {
            type: 'visualization',
            source: { type: 'file_id', file_id: 'visualization-1' },
            format: 'ant-chat.visualization.html.v1',
            title: '依赖关系',
            summary: '展示模块之间的调用关系。',
            size: 128,
            sha256: 'a'.repeat(64),
          },
        ],
      } as IMessage,
    })
    await vi.waitFor(() => expect(connector.send).toHaveBeenCalledOnce())
    expect(connector.send).toHaveBeenCalledWith({
      externalChatId: 'chat-1',
      content: expect.objectContaining({
        kind: 'execution',
        visualization: {
          title: '依赖关系',
          summary: '展示模块之间的调用关系。',
        },
      }),
    })

    events.emit('agent:secret-requested', {
      request: {
        requestId: 'secret-1',
        runId: 'turn-1',
        conversationId: 'conversation-1',
        label: '部署 Token',
        fields: [{ key: 'token', label: 'Token' }],
        reason: '用于部署',
        createdAt: 1,
      },
    })

    await vi.waitFor(() => expect(connector.update).toHaveBeenCalled())
    const content = vi.mocked(connector.update!).mock.calls.at(-1)?.[0].content
    expect(content).toMatchObject({
      kind: 'execution',
      text: expect.stringContaining('请在 Ant Chat 桌面端完成输入'),
      actions: [{ label: '拒绝提供', style: 'danger', token: expect.any(String) }],
    })
    const token = content?.kind === 'execution' ? content.actions?.[0].token : undefined
    expect(delivery.resolveAction({
      channelAccountId: 'account-1',
      externalEventId: 'event-1',
      externalUserId: 'user-1',
      externalChatId: 'chat-1',
      externalMessageId: 'card-1',
      actionToken: token!,
    })).toEqual({
      kind: 'secret.reject',
      requestId: 'secret-1',
      executionId: 'turn-1',
    })
    expect(connector.send).toHaveBeenCalledOnce()
  })

  it('运行卡只允许原操作者停止任务，终态移除动作并展示失败原因', async () => {
    const { connector, delivery, events } = createHarness()
    const source = {
      type: 'channel' as const,
      channelType: 'feishu' as const,
      channelAccountId: 'account-1',
      externalUserId: 'user-1',
      externalChatId: 'chat-1',
      externalMessageId: 'source-message-1',
    }
    events.emit('agent:task-updated', {
      task: {
        taskId: 'task-1',
        userMessageId: 'turn-1',
        conversationId: 'conversation-1',
        status: 'running',
        turnSource: source,
      } as AgentTaskSnapshot,
    })
    events.emit('message:updated', {
      message: {
        id: 'assistant-1',
        turnId: 'turn-1',
        role: 'assistant',
        status: 'loading',
        modelInfo: { provider: '服务一', model: '模型一' },
        content: [{ type: 'text', text: '正在分析' }],
      } as IMessage,
    })

    await vi.waitFor(() => expect(connector.send).toHaveBeenCalledOnce())
    const running = vi.mocked(connector.send).mock.calls[0][0].content
    expect(running).toMatchObject({
      kind: 'execution',
      actions: [{ label: '停止任务', style: 'danger', token: expect.any(String) }],
    })
    const token = running.kind === 'execution' ? running.actions?.[0].token : ''
    expect(delivery.resolveAction({
      channelAccountId: 'account-1',
      externalEventId: 'event-other',
      externalUserId: 'user-2',
      externalChatId: 'chat-1',
      externalMessageId: 'card-1',
      actionToken: token!,
    })).toBeUndefined()
    expect(delivery.resolveAction({
      channelAccountId: 'account-1',
      externalEventId: 'event-owner',
      externalUserId: 'user-1',
      externalChatId: 'chat-1',
      externalMessageId: 'card-1',
      actionToken: token!,
    })).toEqual({ kind: 'task.cancel', taskId: 'task-1' })

    events.emit('agent:task-updated', {
      task: {
        taskId: 'task-1',
        userMessageId: 'turn-1',
        conversationId: 'conversation-1',
        status: 'failed',
        errorMessage: '模型服务不可用',
        summary: '请求执行失败',
        turnSource: source,
      } as AgentTaskSnapshot,
    })

    await vi.waitFor(() => expect(connector.update).toHaveBeenCalled())
    expect(connector.update).toHaveBeenLastCalledWith({
      externalMessageId: 'card-1',
      content: expect.objectContaining({
        kind: 'execution',
        status: 'failed',
        text: '模型服务不可用',
        actions: undefined,
      }),
    })
  })

  it('模型尚未产出首条消息时失败，仍发送带失败原因的终态卡', async () => {
    const { connector, events } = createHarness()
    events.emit('agent:task-updated', {
      task: {
        taskId: 'task-early-failure',
        userMessageId: 'turn-early-failure',
        conversationId: 'conversation-1',
        status: 'failed',
        errorMessage: '模型服务不可用',
        turnSource: {
          type: 'channel',
          channelType: 'feishu',
          channelAccountId: 'account-1',
          externalUserId: 'user-1',
          externalChatId: 'chat-1',
          externalMessageId: 'source-message-1',
        },
      } as AgentTaskSnapshot,
    })

    await vi.waitFor(() => expect(connector.send).toHaveBeenCalledOnce())
    expect(connector.send).toHaveBeenCalledWith({
      externalChatId: 'chat-1',
      content: expect.objectContaining({
        kind: 'execution',
        status: 'failed',
        text: '模型服务不可用',
        model: { provider: '服务一', providerId: 'provider-1', model: '模型一' },
      }),
    })
  })
})

function createWeixinHarness(send = vi.fn(async () => ({ externalMessageId: 'weixin-message-1' }))) {
  const events = new RuntimeEventBus()
  const connector = {
    type: 'weixin',
    capabilities: { supportsUpdate: false },
    send,
    setTyping: vi.fn(async () => ({ changed: true })),
  } as unknown as ChannelConnector
  const data = {
    channelAccountRepository: {
      getById: vi.fn(async () => ({ channelType: 'weixin' })),
    },
    channelReceiptRepository: {
      getOutboundByLocalMessageId: vi.fn(async () => undefined),
      create: vi.fn(async input => ({ id: 'receipt-weixin', ...input })),
      updateExternalMessageId: vi.fn(async () => undefined),
    },
    messageRepository: {
      getById: vi.fn(async () => ({
        id: 'turn-1',
        role: 'user',
        originType: 'weixin',
        originChannelAccountId: 'account-1',
        originExternalChatId: 'chat-1',
      })),
    },
    loadAttachmentData: vi.fn(async (_fileId: string): Promise<string | null> => null),
    conversationRepository: {
      getById: vi.fn(async () => ({
        id: 'conversation-1',
        settings: { providerId: 'provider-1', modelId: 'model-1' },
      })),
    },
    providerSettingsRepository: {
      getAllAvailableModels: vi.fn(() => [{
        id: 'provider-1',
        name: '服务一',
        models: [{ id: 'model-1', name: '模型一' }],
      }]),
    },
  }
  const delivery = new ChannelDelivery({
    events,
    connectors: new Map([['weixin', connector]]),
    data: data as never,
  })
  delivery.start()
  return { connector, data, delivery, events }
}

describe('微信纯文本平台投递', () => {
  const source = {
    type: 'channel' as const,
    channelType: 'weixin' as const,
    channelAccountId: 'account-1',
    externalUserId: 'user-1',
    externalChatId: 'chat-1',
    externalMessageId: 'source-message-1',
  }

  it('awaiting_approval 推送含工具名、预览和 /approve /deny 的审批文本', async () => {
    const { connector, events } = createWeixinHarness()
    events.emit('agent:task-updated', {
      task: {
        taskId: 'task-1',
        userMessageId: 'turn-1',
        conversationId: 'conversation-1',
        status: 'running',
        turnSource: source,
      } as AgentTaskSnapshot,
    })
    events.emit('message:updated', {
      message: {
        id: 'assistant-1',
        turnId: 'turn-1',
        role: 'assistant',
        status: 'loading',
        modelInfo: { provider: '服务一', model: '模型一' },
        content: [{ type: 'text', text: '准备执行命令' }],
      } as IMessage,
    })
    events.emit('agent:task-updated', {
      task: {
        taskId: 'task-1',
        userMessageId: 'turn-1',
        conversationId: 'conversation-1',
        status: 'awaiting_approval',
        pendingAction: {
          actionId: 'approval-1',
          toolName: 'execute_command',
          operationType: 'command',
          scope: 'outside',
          inputPreview: 'git push',
          createdAt: 1,
        },
        turnSource: source,
      } as AgentTaskSnapshot,
    })

    await vi.waitFor(() => expect(connector.send).toHaveBeenCalledOnce())
    const sent = vi.mocked(connector.send).mock.calls[0][0]
    expect(sent.externalChatId).toBe('chat-1')
    expect(sent.content).toMatchObject({ kind: 'execution', status: 'awaiting_approval' })
    const text = sent.content.kind === 'execution' ? sent.content.text : ''
    expect(text).toContain('需要审批：execute_command')
    expect(text).toContain('git push')
    expect(text).toContain('/approve')
    expect(text).toContain('/deny')
  })

  it('模型没有产出正文时，审批提示本身也能发出', async () => {
    const { connector, events } = createWeixinHarness()
    events.emit('agent:task-updated', {
      task: {
        taskId: 'task-1',
        userMessageId: 'turn-1',
        conversationId: 'conversation-1',
        status: 'running',
        turnSource: source,
      } as AgentTaskSnapshot,
    })
    events.emit('message:updated', {
      message: {
        id: 'assistant-1',
        turnId: 'turn-1',
        role: 'assistant',
        status: 'loading',
        modelInfo: { provider: '服务一', model: '模型一' },
        content: [] as IMessage['content'],
      } as IMessage,
    })
    events.emit('agent:task-updated', {
      task: {
        taskId: 'task-1',
        userMessageId: 'turn-1',
        conversationId: 'conversation-1',
        status: 'awaiting_approval',
        pendingAction: {
          actionId: 'approval-2',
          toolName: 'execute_command',
          operationType: 'command',
          scope: 'outside',
          inputPreview: 'pnpm install',
          createdAt: 1,
        },
        turnSource: source,
      } as AgentTaskSnapshot,
    })

    await vi.waitFor(() => expect(connector.send).toHaveBeenCalledOnce())
    const sent = vi.mocked(connector.send).mock.calls[0][0]
    const text = sent.content.kind === 'execution' ? sent.content.text : ''
    expect(text).toContain('需要审批：execute_command')
    expect(text).toContain('pnpm install')
  })

  it('同一审批重复 task-updated 不重复推送', async () => {
    const { connector, events } = createWeixinHarness()
    events.emit('agent:task-updated', {
      task: {
        taskId: 'task-1',
        userMessageId: 'turn-1',
        conversationId: 'conversation-1',
        status: 'running',
        turnSource: source,
      } as AgentTaskSnapshot,
    })
    events.emit('message:updated', {
      message: {
        id: 'assistant-1',
        turnId: 'turn-1',
        role: 'assistant',
        status: 'loading',
        modelInfo: { provider: '服务一', model: '模型一' },
        content: [{ type: 'text', text: '准备执行命令' }],
      } as IMessage,
    })
    const pendingAction = {
      actionId: 'approval-1',
      toolName: 'execute_command',
      operationType: 'command',
      scope: 'outside',
      inputPreview: 'git push',
      createdAt: 1,
    }
    const task = {
      taskId: 'task-1',
      userMessageId: 'turn-1',
      conversationId: 'conversation-1',
      status: 'awaiting_approval',
      pendingAction,
      turnSource: source,
    } as AgentTaskSnapshot
    events.emit('agent:task-updated', { task })
    await vi.waitFor(() => expect(connector.send).toHaveBeenCalledOnce())

    events.emit('agent:task-updated', { task })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(connector.send).toHaveBeenCalledOnce()
  })

  it('/models 在纯文本平台直接发送带序号的文本列表', async () => {
    const { connector, delivery } = createWeixinHarness()
    const event: ChannelInboundEvent = {
      channelAccountId: 'account-1',
      channelType: 'weixin',
      externalUserId: 'user-1',
      externalDisplayName: '用户',
      externalChatId: 'chat-1',
      externalMessageId: 'message-models',
      text: '/models',
    }
    await delivery.deliverCommand(event, 'conversation-1', '1. 服务一 / 模型一\n2. 服务二 / 模型二', {
      kind: 'model-selection',
      models: [
        { providerId: 'provider-1', modelId: 'model-1', label: '服务一 / 模型一', selected: true },
        { providerId: 'provider-2', modelId: 'model-2', label: '服务二 / 模型二', selected: false },
      ],
    })

    expect(connector.send).toHaveBeenCalledWith({
      externalChatId: 'chat-1',
      content: { kind: 'text', text: '1. 服务一 / 模型一\n2. 服务二 / 模型二\n回复 /model <序号> 切换。' },
    })
  })

  it('/mode 在纯文本平台直接发送带序号和命令提示的权限模式列表', async () => {
    const { connector, delivery } = createWeixinHarness()
    const event: ChannelInboundEvent = {
      channelAccountId: 'account-1',
      channelType: 'weixin',
      externalUserId: 'user-1',
      externalDisplayName: '用户',
      externalChatId: 'chat-1',
      externalMessageId: 'message-mode',
      text: '/mode',
    }
    await delivery.deliverCommand(event, 'conversation-1', '请选择权限模式。', {
      kind: 'permission-mode-selection',
      modes: [
        { value: 'strict', label: '默认权限', selected: false },
        { value: 'hybrid', label: '自动审查', selected: true },
        { value: 'full_managed', label: '完全访问权限', selected: false },
      ],
    })

    expect(connector.send).toHaveBeenCalledWith({
      externalChatId: 'chat-1',
      content: {
        kind: 'text',
        text: '1. 默认权限\n✓ 2. 自动审查\n3. 完全访问权限\n回复 /mode <序号> 切换。',
      },
    })
  })

  it('assistant 附件块投影为出站附件并从 file_id 加载字节', async () => {
    const { connector, data, events } = createWeixinHarness()
    vi.mocked(data.loadAttachmentData)
      .mockResolvedValueOnce(Buffer.from('图片字节').toString('base64'))
      .mockResolvedValueOnce(Buffer.from('文档字节').toString('base64'))
    events.emit('agent:task-updated', {
      task: {
        taskId: 'task-1',
        userMessageId: 'turn-1',
        conversationId: 'conversation-1',
        status: 'running',
        turnSource: source,
      } as AgentTaskSnapshot,
    })
    events.emit('message:updated', {
      message: {
        id: 'assistant-attachment',
        turnId: 'turn-1',
        role: 'assistant',
        modelInfo: { provider: '服务一', model: '模型一' },
        content: [
          { type: 'text', text: '文件如下' },
          {
            type: 'image-block',
            source: { type: 'file_id', file_id: 'image-1' },
            name: '截图.png',
            media_type: 'image/png',
            size: 12,
          },
          {
            type: 'document',
            source: { type: 'file_id', file_id: 'doc-1' },
            title: '报告',
            name: '方案.pdf',
            media_type: 'application/pdf',
          },
        ],
      } as IMessage,
    })
    events.emit('agent:task-updated', {
      task: {
        taskId: 'task-1',
        userMessageId: 'turn-1',
        conversationId: 'conversation-1',
        status: 'success',
        turnSource: source,
      } as AgentTaskSnapshot,
    })

    await vi.waitFor(() => expect(connector.send).toHaveBeenCalledOnce())
    expect(connector.send).toHaveBeenCalledWith({
      externalChatId: 'chat-1',
      content: expect.objectContaining({
        kind: 'execution',
        text: '文件如下',
        attachments: [
          {
            name: '截图.png',
            mediaType: 'image/png',
            kind: 'image',
            size: 12,
            data: Buffer.from('图片字节').toString('base64'),
          },
          {
            name: '方案.pdf',
            mediaType: 'application/pdf',
            kind: 'document',
            size: undefined,
            data: Buffer.from('文档字节').toString('base64'),
          },
        ],
      }),
    })
    expect(data.loadAttachmentData).toHaveBeenCalledWith('image-1')
    expect(data.loadAttachmentData).toHaveBeenCalledWith('doc-1')
  })

  it('附件字节缺失或 url 来源时跳过，不阻塞正文发送', async () => {
    const { connector, data, events } = createWeixinHarness()
    vi.mocked(data.loadAttachmentData).mockResolvedValue(null)
    events.emit('agent:task-updated', {
      task: {
        taskId: 'task-1',
        userMessageId: 'turn-1',
        conversationId: 'conversation-1',
        status: 'running',
        turnSource: source,
      } as AgentTaskSnapshot,
    })
    events.emit('message:updated', {
      message: {
        id: 'assistant-attachment-missing',
        turnId: 'turn-1',
        role: 'assistant',
        modelInfo: { provider: '服务一', model: '模型一' },
        content: [
          { type: 'text', text: '正文照发' },
          { type: 'image-block', source: { type: 'file_id', file_id: 'missing-1' }, name: '丢.png', media_type: 'image/png' },
          { type: 'file', source: { type: 'url', url: 'https://example.com/a.txt' }, name: '远程.txt', media_type: 'text/plain' },
        ],
      } as IMessage,
    })
    events.emit('agent:task-updated', {
      task: {
        taskId: 'task-1',
        userMessageId: 'turn-1',
        conversationId: 'conversation-1',
        status: 'success',
        turnSource: source,
      } as AgentTaskSnapshot,
    })

    await vi.waitFor(() => expect(connector.send).toHaveBeenCalledOnce())
    const content = vi.mocked(connector.send).mock.calls[0][0].content
    expect(content).toMatchObject({ kind: 'execution', text: '正文照发' })
    expect(content.attachments).toBeUndefined()
  })

  it('仅含附件没有正文时也发送（纯文本平台不再被空文本守卫丢弃）', async () => {
    const { connector, data, events } = createWeixinHarness()
    vi.mocked(data.loadAttachmentData).mockResolvedValue(Buffer.from('字节').toString('base64'))
    events.emit('agent:task-updated', {
      task: {
        taskId: 'task-1',
        userMessageId: 'turn-1',
        conversationId: 'conversation-1',
        status: 'running',
        turnSource: source,
      } as AgentTaskSnapshot,
    })
    events.emit('message:updated', {
      message: {
        id: 'assistant-attachment-only',
        turnId: 'turn-1',
        role: 'assistant',
        modelInfo: { provider: '服务一', model: '模型一' },
        content: [
          { type: 'file', source: { type: 'file_id', file_id: 'file-1' }, filename: '数据.csv', media_type: 'text/csv' },
        ],
      } as IMessage,
    })
    events.emit('agent:task-updated', {
      task: {
        taskId: 'task-1',
        userMessageId: 'turn-1',
        conversationId: 'conversation-1',
        status: 'success',
        turnSource: source,
      } as AgentTaskSnapshot,
    })

    await vi.waitFor(() => expect(connector.send).toHaveBeenCalledOnce())
    const content = vi.mocked(connector.send).mock.calls[0][0].content
    expect(content).toMatchObject({
      kind: 'execution',
      text: '',
      attachments: [{ name: '数据.csv', mediaType: 'text/csv', kind: 'file' }],
    })
  })
})
