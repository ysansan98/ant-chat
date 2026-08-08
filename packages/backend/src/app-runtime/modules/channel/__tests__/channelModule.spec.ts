import type { AgentTaskSnapshot, IMessage } from '@ant-chat/shared'
import type { ChannelConnector, ChannelInboundEvent } from '../../../../channels'
import { Buffer } from 'node:buffer'
import { RuntimeEventBus } from '../../../../events'
import { describe, expect, it, vi } from 'vitest'
import { ChannelModule } from '..'

describe('channel module 平台回包', () => {
  it('sendAttachment 按账号定位 connector 并透传，失败向上抛', async () => {
    const account = {
      id: 'a1',
      channelType: 'feishu' as const,
      displayName: '飞书',
      credentialRef: 'credential-1',
      defaultWorkspacePath: '/workspace',
      permissionMode: 'hybrid' as const,
      enabled: true,
      status: 'connected' as const,
      createdAt: 1,
      updatedAt: 1,
    }
    const connector: ChannelConnector = {
      type: 'feishu',
      capabilities: { supportsUpdate: true },
      setup: vi.fn(async () => ({})),
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      send: vi.fn(async () => ({ externalMessageId: 'reply-1' })),
      sendAttachment: vi.fn(async () => ({ messageId: 'attachment-1' })),
      getStatus: vi.fn(() => ({ status: 'connected' as const })),
    }
    const module = new ChannelModule({
      data: {
        channelAccountRepository: { getById: vi.fn(async () => account) },
      },
      events: new RuntimeEventBus(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      secretStore: {},
    } as never, {} as never, [connector])
    const attachment = {
      name: '报告.md',
      mediaType: 'text/markdown',
      kind: 'document' as const,
      data: Buffer.from('内容').toString('base64'),
    }

    await expect(module.sendAttachment({
      channelAccountId: 'a1',
      externalChatId: 'chat-1',
      attachment,
    })).resolves.toEqual({ messageId: 'attachment-1' })
    expect(connector.sendAttachment).toHaveBeenCalledWith({
      externalChatId: 'chat-1',
      attachment,
    })
  })

  it('已配对用户发送 /status 后由原 connector 回复结果', async () => {
    const account = {
      id: 'a1',
      channelType: 'feishu' as const,
      displayName: '飞书',
      credentialRef: 'credential-1',
      defaultWorkspacePath: '/workspace',
      permissionMode: 'hybrid' as const,
      enabled: true,
      status: 'connected' as const,
      createdAt: 1,
      updatedAt: 1,
    }
    const conversation = {
      id: 'c1',
      workspacePath: '/workspace',
      title: 'Untitled',
      conversationInstructions: '',
      createdAt: 1,
      updatedAt: 1,
      settings: { modelId: 'model-1', providerId: 'provider-1' },
      sourceType: 'feishu' as const,
      sourceChannelAccountId: 'a1',
      sourceExternalChatId: 'chat-1',
    }
    let onInbound: ((event: ChannelInboundEvent) => Promise<void>) | undefined
    let onAction: Parameters<ChannelConnector['start']>[0]['onAction'] | undefined
    const setTyping = vi.fn(async () => ({ changed: true }))
    const connector: ChannelConnector = {
      type: 'feishu',
      capabilities: { supportsUpdate: true },
      setup: vi.fn(async () => ({})),
      start: vi.fn(async (input) => {
        onInbound = input.onInbound
        onAction = input.onAction
      }),
      stop: vi.fn(async () => {}),
      send: vi.fn(async () => ({ externalMessageId: 'reply-1' })),
      sendAttachment: vi.fn(async () => ({ messageId: 'attachment-1' })),
      update: vi.fn(async () => {}),
      setTyping,
      getStatus: vi.fn(() => ({ status: 'connected' as const })),
    }
    const data = {
      channelAccountRepository: {
        list: vi.fn(async () => [account]),
        getById: vi.fn(async () => account),
        updateStatus: vi.fn(),
        updatePermissionMode: vi.fn(async (_id, permissionMode) => ({ ...account, permissionMode })),
      },
      channelPairingRepository: {
        get: vi.fn(async () => ({ id: 'pair-1', channelAccountId: 'a1', externalUserId: 'u1', status: 'authorized' as const, requestedAt: 1 })),
      },
      channelReceiptRepository: {
        get: vi.fn(async () => undefined),
        getOutboundByLocalMessageId: vi.fn(async () => undefined),
        create: vi.fn(async input => ({ id: `receipt-${input.direction}`, ...input })),
        updateStatus: vi.fn(),
      },
      channelSessionRepository: {
        get: vi.fn(async () => ({ channelAccountId: 'a1', externalChatId: 'chat-1', activeConversationId: 'c1', currentWorkspacePath: '/workspace', createdAt: 1, updatedAt: 1 })),
      },
      workspaceService: {
        listWorkspaces: vi.fn(() => ({ workspaces: [{ path: '/workspace' }] })),
        isWorkspaceAvailable: vi.fn(() => true),
      },
      conversationRepository: {
        getById: vi.fn(async () => conversation),
        update: vi.fn(async input => ({ ...conversation, ...input })),
      },
      messageRepository: {
        create: vi.fn(async () => ({ id: 'command-message' })),
      },
      providerSettingsRepository: {
        getAllAvailableModels: vi.fn(() => [{
          id: 'provider-1',
          name: '服务一',
          models: [{
            id: 'model-1',
            providerId: 'provider-1',
            name: '模型一',
          }],
        }]),
      },
    }
    const startTurn = vi.fn(async () => ({
      taskId: 'task-1',
      conversationId: 'c1',
      userMessageId: 'local-message-1',
      conversation,
    }))
    const events = new RuntimeEventBus()
    const updateConversation = vi.fn(async (input) => {
      const updated = { ...conversation, ...input }
      await data.conversationRepository.update(input)
      events.emit('conversation:updated', { conversation: updated })
      return updated
    })
    let activeTasks: AgentTaskSnapshot[] = []
    const approvePendingAction = vi.fn()
    const cancelTask = vi.fn()
    const module = new ChannelModule({
      data,
      events,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      secretStore: { resolve: vi.fn(async () => 'credential') },
    } as never, {
      turnService: { startTurn },
      updateConversation,
      listActiveTasks: vi.fn(() => activeTasks),
      approvePendingAction,
      cancelTask,
    } as never, [connector])

    await module.initialize()
    await onInbound?.({
      channelAccountId: 'a1',
      channelType: 'feishu',
      externalUserId: 'u1',
      externalDisplayName: '用户',
      externalChatId: 'chat-1',
      externalMessageId: 'message-1',
      text: '/status',
    })
    await onInbound?.({
      channelAccountId: 'a1',
      channelType: 'feishu',
      externalUserId: 'u1',
      externalDisplayName: '用户',
      externalChatId: 'chat-1',
      externalMessageId: 'message-2',
      text: '/model',
    })
    await onInbound?.({
      channelAccountId: 'a1',
      channelType: 'feishu',
      externalUserId: 'u1',
      externalDisplayName: '用户',
      externalChatId: 'chat-1',
      externalMessageId: 'message-3',
      text: '你好',
    })
    await onInbound?.({
      channelAccountId: 'a1',
      channelType: 'feishu',
      externalUserId: 'u1',
      externalDisplayName: '用户',
      externalChatId: 'chat-1',
      externalMessageId: 'message-4',
      text: '/models',
    })

    expect(connector.send).toHaveBeenNthCalledWith(1, {
      externalChatId: 'chat-1',
      content: { kind: 'text', text: '当前会话：c1\n工作区：/workspace\n当前模型：服务一 / 模型一\n权限模式：自动审查' },
    })
    expect(connector.send).toHaveBeenNthCalledWith(2, {
      externalChatId: 'chat-1',
      content: { kind: 'text', text: '用法：/model <名称或序号>' },
    })
    expect(connector.send).toHaveBeenNthCalledWith(3, {
      externalChatId: 'chat-1',
      content: {
        kind: 'model-selection',
        title: '选择模型',
        token: expect.any(String),
        models: [{
          label: '1. 服务一 / 模型一',
          selected: true,
          value: expect.any(String),
        }],
      },
    })
    expect(setTyping.mock.calls).toEqual([
      [{ externalMessageId: 'message-1', typing: true }],
      [{ externalMessageId: 'message-1', typing: false }],
      [{ externalMessageId: 'message-2', typing: true }],
      [{ externalMessageId: 'message-2', typing: false }],
      [{ externalMessageId: 'message-3', typing: true }],
      [{ externalMessageId: 'message-4', typing: true }],
      [{ externalMessageId: 'message-4', typing: false }],
    ])
    expect(startTurn).toHaveBeenCalledOnce()

    const modelsCall = vi.mocked(connector.send).mock.calls[2][0]
    const token = modelsCall.content.kind === 'model-selection' ? modelsCall.content.token : ''
    const modelValue = modelsCall.content.kind === 'model-selection' ? modelsCall.content.models[0].value : ''
    const actionResult = await onAction?.({
      channelAccountId: 'a1',
      externalEventId: 'action-1',
      externalUserId: 'u1',
      externalChatId: 'chat-1',
      externalMessageId: 'reply-1',
      actionToken: token,
      formValues: { model: modelValue },
    })
    expect(actionResult).toEqual({
      status: 'success',
      message: '已切换模型：服务一 / 模型一',
      updatedContent: {
        kind: 'notice',
        title: '模型已切换',
        text: '已切换模型：服务一 / 模型一',
        tone: 'success',
      },
    })
    expect(data.conversationRepository.update).toHaveBeenCalledWith({
      id: 'c1',
      settings: expect.objectContaining({ providerId: 'provider-1', modelId: 'model-1' }),
    })
    expect(connector.update).not.toHaveBeenCalled()

    await onInbound?.({
      channelAccountId: 'a1',
      channelType: 'feishu',
      externalUserId: 'u1',
      externalDisplayName: '用户',
      externalChatId: 'chat-1',
      externalMessageId: 'message-mode',
      text: '/mode',
    })
    const modeCall = vi.mocked(connector.send).mock.calls[3][0]
    const modeToken = modeCall.content.kind === 'permission-mode-selection' ? modeCall.content.token : ''
    const fullManagedValue = modeCall.content.kind === 'permission-mode-selection' ? modeCall.content.modes[2].value : ''
    expect(modeCall.content).toMatchObject({
      kind: 'permission-mode-selection',
      modes: [
        { label: '默认权限', selected: false },
        { label: '自动审查', selected: true },
        { label: '完全访问权限', selected: false },
      ],
    })
    expect(await onAction?.({
      channelAccountId: 'a1',
      externalEventId: 'action-mode',
      externalUserId: 'u1',
      externalChatId: 'chat-1',
      externalMessageId: 'reply-mode',
      actionToken: modeToken,
      formValues: { permissionMode: fullManagedValue },
    })).toEqual({
      status: 'success',
      message: '已切换权限模式：完全访问权限',
      updatedContent: {
        kind: 'notice',
        title: '权限模式已切换',
        text: '已切换权限模式：完全访问权限',
        tone: 'success',
      },
    })
    expect(data.channelAccountRepository.updatePermissionMode).toHaveBeenCalledWith('a1', 'full_managed')
    expect(connector.update).not.toHaveBeenCalled()

    const turnSource = {
      type: 'channel' as const,
      channelType: 'feishu' as const,
      channelAccountId: 'a1',
      externalUserId: 'u1',
      externalChatId: 'chat-1',
      externalMessageId: 'message-3',
    }
    const runningTask = {
      taskId: 'task-approval',
      userMessageId: 'local-message-1',
      conversationId: 'c1',
      status: 'running',
      turnSource,
    } as AgentTaskSnapshot
    activeTasks = [runningTask]
    events.emit('agent:task-updated', { task: runningTask })
    events.emit('message:updated', {
      message: {
        id: 'assistant-approval',
        turnId: 'local-message-1',
        role: 'assistant',
        status: 'loading',
        modelInfo: { provider: '服务一', model: '模型一' },
        content: [{ type: 'text', text: '准备执行命令' }],
      } as IMessage,
    })
    await vi.waitFor(() => expect(connector.send).toHaveBeenCalledTimes(5))
    await expect(module.runtime.executeCommand({
      event: {
        channelAccountId: 'a1',
        channelType: 'feishu',
        externalUserId: 'u1',
        externalDisplayName: '用户',
        externalChatId: 'chat-1',
        externalMessageId: 'message-stop',
        text: '/stop',
      },
      conversationId: 'c1',
      command: { id: 'stop' },
    })).resolves.toBe('已请求停止当前任务。')
    expect(cancelTask).toHaveBeenCalledWith({ taskId: 'task-approval' })
    cancelTask.mockClear()
    const runningCall = vi.mocked(connector.send).mock.calls[4][0]
    const cancelToken = runningCall.content.kind === 'execution'
      ? runningCall.content.actions?.[0].token
      : undefined
    expect(await onAction?.({
      channelAccountId: 'a1',
      externalEventId: 'action-other-user',
      externalUserId: 'u2',
      externalChatId: 'chat-1',
      externalMessageId: 'reply-running',
      actionToken: cancelToken!,
    })).toEqual({ status: 'error', message: '卡片操作无效或已过期。' })
    expect(cancelTask).not.toHaveBeenCalled()
    const cancelResults = await Promise.all([
      onAction?.({
        channelAccountId: 'a1',
        externalEventId: 'action-cancel-1',
        externalUserId: 'u1',
        externalChatId: 'chat-1',
        externalMessageId: 'reply-running',
        actionToken: cancelToken!,
      }),
      onAction?.({
        channelAccountId: 'a1',
        externalEventId: 'action-cancel-2',
        externalUserId: 'u1',
        externalChatId: 'chat-1',
        externalMessageId: 'reply-running',
        actionToken: cancelToken!,
      }),
    ])
    expect(cancelResults).toEqual(expect.arrayContaining([
      { status: 'success', message: '已请求停止当前任务。' },
      { status: 'error', message: '卡片操作无效或已过期。' },
    ]))
    expect(cancelTask).toHaveBeenCalledOnce()
    expect(cancelTask).toHaveBeenCalledWith({ taskId: 'task-approval' })

    const awaitingTask = {
      taskId: 'task-approval',
      userMessageId: 'local-message-1',
      conversationId: 'c1',
      status: 'awaiting_approval',
      pendingAction: {
        actionId: 'approval-1',
        toolName: 'execute_command',
        operationType: 'command',
        scope: 'outside',
        inputPreview: 'git push',
        createdAt: 1,
      },
      turnSource,
    } as AgentTaskSnapshot
    activeTasks = [awaitingTask]
    events.emit('agent:task-updated', { task: awaitingTask })
    await vi.waitFor(() => expect(connector.send).toHaveBeenCalledTimes(6))
    const approvalCall = vi.mocked(connector.send).mock.calls[5][0]
    const approvalToken = approvalCall.content.kind === 'execution'
      ? approvalCall.content.actions?.[0].token
      : undefined

    const approvalResult = await onAction?.({
      channelAccountId: 'a1',
      externalEventId: 'action-2',
      externalUserId: 'u1',
      externalChatId: 'chat-1',
      externalMessageId: 'reply-1',
      actionToken: approvalToken!,
    })
    expect(approvalResult).toEqual({ status: 'success', message: '已批准，本次任务将继续执行。' })
    expect(approvePendingAction).toHaveBeenCalledWith({
      taskId: 'task-approval',
      actionId: 'approval-1',
    })
  })
})
