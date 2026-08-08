import { Buffer } from 'node:buffer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFeishuTransport } from '../transport'

const sdk = vi.hoisted(() => ({
  createMessage: vi.fn(),
  patchMessage: vi.fn(),
  createFile: vi.fn(),
  createImage: vi.fn(),
  createReaction: vi.fn(),
  deleteReaction: vi.fn(),
  eventHandlers: {} as Record<string, (event: unknown) => Promise<unknown>>,
  startWs: vi.fn(),
  closeWs: vi.fn(),
}))

vi.mock('@larksuiteoapi/node-sdk', () => ({
  Client: class {
    im = {
      v1: {
        message: { create: sdk.createMessage, patch: sdk.patchMessage },
        file: { create: sdk.createFile },
        image: { create: sdk.createImage },
        messageReaction: {
          create: sdk.createReaction,
          delete: sdk.deleteReaction,
        },
      },
    }
  },
  EventDispatcher: class {
    register(handlers: Record<string, (event: unknown) => Promise<unknown>>) {
      Object.assign(sdk.eventHandlers, handlers)
      return this
    }
  },
  LoggerLevel: { warn: 'warn' },
  WSClient: class {
    start = sdk.startWs
    close = sdk.closeWs
  },
}))

describe('飞书 transport 出站行为', () => {
  beforeEach(() => {
    sdk.createMessage.mockReset()
    sdk.patchMessage.mockReset()
    sdk.createFile.mockReset()
    sdk.createImage.mockReset()
    sdk.createReaction.mockReset()
    sdk.deleteReaction.mockReset()
    sdk.startWs.mockReset().mockResolvedValue(undefined)
    sdk.closeWs.mockReset()
    for (const key of Object.keys(sdk.eventHandlers))
      delete sdk.eventHandlers[key]
  })

  it('把 Agent 回复渲染为飞书 Markdown 卡片', async () => {
    sdk.createMessage.mockResolvedValue({ data: { message_id: 'message-1' } })
    sdk.patchMessage.mockResolvedValue({})
    const transport = createFeishuTransport('{"appId":"cli_x","appSecret":"secret"}')
    const execution = {
      kind: 'execution' as const,
      executionId: 'turn-1',
      status: 'running' as const,
      text: '**处理中**',
      model: { provider: '服务一', model: '模型一' },
      steps: [],
    }

    const result = await transport.createCard('chat-1', execution)
    await transport.updateCard('message-1', { ...execution, status: 'success', text: '**已完成**' })

    expect(result).toEqual({ messageId: 'message-1' })
    expect(sdk.createMessage).toHaveBeenCalledWith(expect.objectContaining({
      params: { receive_id_type: 'chat_id' },
      data: expect.objectContaining({ receive_id: 'chat-1', msg_type: 'interactive' }),
    }))
    const createdCard = JSON.parse(sdk.createMessage.mock.calls[0][0].data.content)
    expect(createdCard).toMatchObject({
      schema: '2.0',
      config: {
        update_multi: true,
        summary: { content: '正在执行：**处理中**' },
      },
      header: { title: { content: '正在执行' }, template: 'blue' },
      body: { elements: expect.arrayContaining([
        { tag: 'markdown', content: '**处理中**' },
        { tag: 'markdown', content: '---\n模型：服务一 / 模型一' },
      ]) },
    })
    expect(sdk.patchMessage).toHaveBeenCalledWith(expect.objectContaining({
      path: { message_id: 'message-1' },
    }))
    const updatedCard = JSON.parse(sdk.patchMessage.mock.calls[0][0].data.content)
    expect(updatedCard).toMatchObject({
      config: { summary: { content: '执行完成：**已完成**' } },
      header: { title: { content: '执行完成' }, template: 'green' },
    })
  })

  it('把模型选择渲染为单个表单，而不是一组动作按钮', async () => {
    sdk.createMessage.mockResolvedValue({ data: { message_id: 'message-model' } })
    const transport = createFeishuTransport('{"appId":"cli_x","appSecret":"secret"}')

    await transport.createCard('chat-1', {
      kind: 'model-selection',
      title: '选择模型',
      token: 'submit-token',
      models: [
        { label: '服务一 / 模型一', value: 'option-1', selected: true },
        { label: '服务二 / 模型二', value: 'option-2', selected: false },
      ],
    })

    const card = JSON.parse(sdk.createMessage.mock.calls[0][0].data.content)
    expect(card.config.summary.content).toBe('选择后会应用到当前频道会话。')
    expect(card.body.elements[1]).toMatchObject({
      tag: 'form',
      name: 'model-selection',
      elements: [
        {
          tag: 'select_static',
          name: 'model',
          initial_option: 'option-1',
          options: [
            { text: { content: '服务一 / 模型一' }, value: 'option-1' },
            { text: { content: '服务二 / 模型二' }, value: 'option-2' },
          ],
        },
        {
          tag: 'button',
          name: 'submit',
          form_action_type: 'submit',
          type: 'primary',
          behaviors: [{ type: 'callback', value: { token: 'submit-token' } }],
        },
      ],
    })
  })

  it('把权限模式选择渲染为带当前值的单个表单', async () => {
    sdk.createMessage.mockResolvedValue({ data: { message_id: 'message-mode' } })
    const transport = createFeishuTransport('{"appId":"cli_x","appSecret":"secret"}')

    await transport.createCard('chat-1', {
      kind: 'permission-mode-selection',
      title: '选择权限模式',
      token: 'mode-token',
      modes: [
        { label: '默认权限', value: 'option-1', selected: false },
        { label: '自动审查', value: 'option-2', selected: true },
        { label: '完全访问权限', value: 'option-3', selected: false },
      ],
    })

    const card = JSON.parse(sdk.createMessage.mock.calls[0][0].data.content)
    expect(card.config.summary.content).toBe('选择后会应用到当前频道的后续任务。')
    expect(card.body.elements[1]).toMatchObject({
      tag: 'form',
      name: 'permission-mode-selection',
      elements: [
        {
          tag: 'select_static',
          name: 'permissionMode',
          initial_option: 'option-2',
          options: [
            { text: { content: '默认权限' }, value: 'option-1' },
            { text: { content: '自动审查' }, value: 'option-2' },
            { text: { content: '完全访问权限' }, value: 'option-3' },
          ],
        },
        {
          tag: 'button',
          name: 'submit',
          form_action_type: 'submit',
          type: 'primary',
          behaviors: [{ type: 'callback', value: { token: 'mode-token' } }],
        },
      ],
    })
  })

  it('普通频道命令仍发送文本消息', async () => {
    sdk.createMessage.mockResolvedValue({ data: { message_id: 'message-1' } })
    const transport = createFeishuTransport('{"appId":"cli_x","appSecret":"secret"}')

    await transport.sendText('chat-1', '当前状态正常')

    expect(sdk.createMessage).toHaveBeenCalledWith({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: 'chat-1',
        msg_type: 'text',
        content: JSON.stringify({ text: '当前状态正常' }),
      },
    })
  })

  it('用 Typing reaction 标记用户消息并按 reaction id 删除', async () => {
    sdk.createReaction.mockResolvedValue({ data: { reaction_id: 'reaction-1' } })
    sdk.deleteReaction.mockResolvedValue({})
    const transport = createFeishuTransport('{"appId":"cli_x","appSecret":"secret"}')

    await transport.setTyping('message-1', true)
    await transport.setTyping('message-1', false)

    expect(sdk.createReaction).toHaveBeenCalledWith({
      path: { message_id: 'message-1' },
      data: { reaction_type: { emoji_type: 'Typing' } },
    })
    expect(sdk.deleteReaction).toHaveBeenCalledWith({
      path: { message_id: 'message-1', reaction_id: 'reaction-1' },
    })
  })

  it('通过长连接接收卡片操作并在回调中返回终态卡片', async () => {
    const logger = {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    }
    const transport = createFeishuTransport('{"appId":"cli_x","appSecret":"secret"}', logger)
    const onAction = vi.fn(async () => ({
      status: 'success' as const,
      message: '已切换权限模式：完全访问权限',
      updatedContent: {
        kind: 'notice' as const,
        title: '权限模式已切换',
        text: '已切换权限模式：完全访问权限',
        tone: 'success' as const,
      },
    }))

    await transport.connect({
      onMessage: vi.fn(async () => {}),
      onAction,
    })
    const event = {
      event_id: 'action-1',
      event_type: 'card.action.trigger',
      operator: { open_id: 'user-1' },
      context: { open_chat_id: 'chat-1', open_message_id: 'card-1' },
      action: { value: { token: 'token-1' } },
    }
    const result = await sdk.eventHandlers['card.action.trigger'](event)

    expect(sdk.startWs).toHaveBeenCalledOnce()
    expect(onAction).toHaveBeenCalledWith(event)
    expect(result).toMatchObject({
      toast: { type: 'success', content: '已切换权限模式：完全访问权限' },
      card: {
        type: 'raw',
        data: {
          schema: '2.0',
          header: {
            title: { content: '权限模式已切换' },
            template: 'green',
          },
          body: {
            elements: [{ tag: 'markdown', content: '已切换权限模式：完全访问权限' }],
          },
        },
      },
    })
    expect(sdk.patchMessage).not.toHaveBeenCalled()
    expect(logger.info.mock.calls).toContainEqual([
      '[消息频道] 飞书 SDK 收到卡片操作',
      {
        eventId: 'action-1',
        eventType: 'card.action.trigger',
        messageId: 'card-1',
      },
    ])
    expect(logger.info.mock.calls).toContainEqual([
      '[消息频道] 飞书卡片操作即将响应',
      {
        eventId: 'action-1',
        messageId: 'card-1',
        status: 'success',
        hasUpdatedCard: true,
      },
    ])
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('token-1')
  })

  it('卡片操作没有终态内容时只返回 toast', async () => {
    const transport = createFeishuTransport('{"appId":"cli_x","appSecret":"secret"}')
    const onAction = vi.fn(async () => ({ status: 'error' as const, message: '卡片操作无效或已过期。' }))

    await transport.connect({
      onMessage: vi.fn(async () => {}),
      onAction,
    })
    const result = await sdk.eventHandlers['card.action.trigger']({
      event_id: 'action-expired',
      event_type: 'card.action.trigger',
      operator: { open_id: 'user-1' },
      context: { open_chat_id: 'chat-1', open_message_id: 'card-1' },
      action: { value: { token: 'expired-token' } },
    })

    expect(result).toEqual({
      toast: { type: 'error', content: '卡片操作无效或已过期。' },
    })
  })

  it('卡片操作处理异常时记录脱敏上下文并继续抛出', async () => {
    const error = new Error('callback failed')
    const logger = {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    }
    const transport = createFeishuTransport('{"appId":"cli_x","appSecret":"secret"}', logger)

    await transport.connect({
      onMessage: vi.fn(async () => {}),
      onAction: vi.fn(async () => {
        throw error
      }),
    })
    const action = sdk.eventHandlers['card.action.trigger']({
      event_id: 'action-failed',
      event_type: 'card.action.trigger',
      operator: { open_id: 'user-1' },
      context: { open_chat_id: 'chat-1', open_message_id: 'card-1' },
      action: { value: { token: 'secret-token' }, form_value: { permissionMode: 'secret-value' } },
    })

    await expect(action).rejects.toThrow('callback failed')
    expect(logger.error).toHaveBeenCalledWith(
      '[消息频道] 飞书卡片操作处理异常',
      {
        eventId: 'action-failed',
        messageId: 'card-1',
        error,
      },
    )
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('secret-token')
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('secret-value')
  })

  it('按附件类型上传图片并发送 image 消息', async () => {
    sdk.createImage.mockResolvedValue({ image_key: 'image-key-1' })
    sdk.createMessage.mockResolvedValue({ data: { message_id: 'message-image' } })
    const transport = createFeishuTransport('{"appId":"cli_x","appSecret":"secret"}')
    const bytes = Buffer.from('fake-png')

    const result = await transport.sendFile('chat-1', {
      name: '截图.png',
      mediaType: 'image/png',
      kind: 'image',
      data: bytes.toString('base64'),
    })

    expect(result).toEqual({ messageId: 'message-image' })
    expect(sdk.createImage).toHaveBeenCalledWith({
      data: { image_type: 'message', image: bytes },
    })
    expect(sdk.createMessage).toHaveBeenCalledWith({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: 'chat-1',
        msg_type: 'image',
        content: JSON.stringify({ image_key: 'image-key-1' }),
      },
    })
  })

  it('按扩展名映射 file_type，未知类型落 stream 并保留文件名', async () => {
    sdk.createFile.mockResolvedValue({ file_key: 'file-key-1' })
    sdk.createMessage.mockResolvedValue({ data: { message_id: 'message-file' } })
    const transport = createFeishuTransport('{"appId":"cli_x","appSecret":"secret"}')
    const bytes = Buffer.from('fake-pdf')

    const result = await transport.sendFile('chat-1', {
      name: '方案.pdf',
      mediaType: 'application/pdf',
      kind: 'document',
      data: bytes.toString('base64'),
    })

    expect(result).toEqual({ messageId: 'message-file' })
    expect(sdk.createFile).toHaveBeenCalledWith({
      data: {
        file_type: 'pdf',
        file_name: '方案.pdf',
        file: bytes,
      },
    })
    expect(sdk.createMessage).toHaveBeenCalledWith({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: 'chat-1',
        msg_type: 'file',
        content: JSON.stringify({ file_key: 'file-key-1' }),
      },
    })

    sdk.createFile.mockClear()
    await transport.sendFile('chat-1', {
      name: 'archive.bin',
      mediaType: 'application/octet-stream',
      kind: 'file',
      data: bytes.toString('base64'),
    })
    expect(sdk.createFile).toHaveBeenCalledWith(expect.objectContaining({
      data: { file_type: 'stream', file_name: 'archive.bin', file: bytes },
    }))
  })

  it('超过飞书文件/图片上限时报错', async () => {
    const transport = createFeishuTransport('{"appId":"cli_x","appSecret":"secret"}')
    await expect(transport.sendFile('chat-1', {
      name: 'big.jpg',
      mediaType: 'image/jpeg',
      kind: 'image',
      data: Buffer.alloc(10 * 1024 * 1024 + 1).toString('base64'),
    })).rejects.toThrow('超过 10MB 上限')
    await expect(transport.sendFile('chat-1', {
      name: 'big.bin',
      mediaType: 'application/octet-stream',
      kind: 'file',
      data: Buffer.alloc(30 * 1024 * 1024 + 1).toString('base64'),
    })).rejects.toThrow('超过 30MB 上限')
    expect(sdk.createImage).not.toHaveBeenCalled()
    expect(sdk.createFile).not.toHaveBeenCalled()
  })
})
