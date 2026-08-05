import type { IConversations, IMessage } from '@ant-chat/shared'
import { describe, expect, it, vi } from 'vitest'
import { RuntimeEventBus } from '../../events'
import { createConversationLifecycle } from '../conversationLifecycle'

describe('conversationLifecycle', () => {
  it('新 Turn 启动失败时回滚未发布的会话，不产生 ghost event', async () => {
    const created = conversation({ id: 'new-conversation' })
    const repository = {
      create: vi.fn(async () => created),
      delete: vi.fn(async () => true),
    }
    const events = new RuntimeEventBus()
    const published: IConversations[] = []
    events.on('conversation:updated', ({ conversation }) => published.push(conversation))
    const lifecycle = createConversationLifecycle({
      data: {
        conversationRepository: repository,
        messageRepository: {},
        loadAttachmentData: vi.fn(),
        workspaceService: {},
      } as never,
      events,
      runtime: { closeConversation: vi.fn(), listActiveTasks: vi.fn(() => []) },
    })

    const creation = await lifecycle.beginCreate({
      title: 'Untitled',
      workspacePath: '/workspace',
      conversationInstructions: '',
      createdAt: 1,
      updatedAt: 1,
      settings: created.settings,
    })
    expect(published).toEqual([])

    await creation.rollback()

    expect(repository.delete).toHaveBeenCalledWith(created.id)
    expect(published).toEqual([])
  })

  it('新 Turn 启动成功后才发布会话且只发布一次', async () => {
    const created = conversation({ id: 'new-conversation' })
    const events = new RuntimeEventBus()
    const published: IConversations[] = []
    events.on('conversation:updated', ({ conversation }) => published.push(conversation))
    const lifecycle = createConversationLifecycle({
      data: {
        conversationRepository: { create: vi.fn(async () => created) },
        messageRepository: {},
        loadAttachmentData: vi.fn(),
        workspaceService: {},
      } as never,
      events,
      runtime: { closeConversation: vi.fn(), listActiveTasks: vi.fn(() => []) },
    })

    const creation = await lifecycle.beginCreate({
      title: 'Untitled',
      workspacePath: '/workspace',
      conversationInstructions: '',
      createdAt: 1,
      updatedAt: 1,
      settings: created.settings,
    })
    creation.commit()
    creation.commit()

    expect(published).toEqual([created])
  })

  it('拒绝创建未关联工作区的会话', async () => {
    const create = vi.fn()
    const lifecycle = createConversationLifecycle({
      data: {
        conversationRepository: { create },
        messageRepository: {},
        loadAttachmentData: vi.fn(),
        workspaceService: {},
      } as never,
      events: new RuntimeEventBus(),
      runtime: { closeConversation: vi.fn(), listActiveTasks: vi.fn(() => []) },
    })

    await expect(lifecycle.create({ workspacePath: '', title: '会话' } as never))
      .rejects
      .toThrow('缺少工作区路径')
    expect(create).not.toHaveBeenCalled()
  })

  it('任务运行中时拒绝归档且保持会话状态', async () => {
    const setArchived = vi.fn()
    const lifecycle = createConversationLifecycle({
      data: {
        conversationRepository: { setArchived },
        messageRepository: {},
        loadAttachmentData: vi.fn(),
        workspaceService: {},
      } as never,
      events: new RuntimeEventBus(),
      runtime: {
        closeConversation: vi.fn(),
        listActiveTasks: vi.fn(() => [{ taskId: 'running-task' }] as never),
      },
    })

    await expect(lifecycle.archive('conversation-1')).rejects.toThrow('任务运行中，暂时无法归档')
    expect(setArchived).not.toHaveBeenCalled()
  })

  it('归档保留 Trace，永久删除成功后清理对应 Trace', async () => {
    const current = conversation({ id: 'conversation-1' })
    const deleteTrace = vi.fn(async () => {})
    const repository = {
      setArchived: vi.fn(async () => ({ ...current, archived: true })),
      delete: vi.fn(async () => true),
    }
    const lifecycle = createConversationLifecycle({
      data: {
        conversationRepository: repository,
        messageRepository: {},
        loadAttachmentData: vi.fn(),
        workspaceService: {},
      } as never,
      events: new RuntimeEventBus(),
      runtime: { closeConversation: vi.fn(), listActiveTasks: vi.fn(() => []) },
      observability: { deleteConversation: deleteTrace },
    })

    await lifecycle.archive(current.id)
    expect(deleteTrace).not.toHaveBeenCalled()
    await lifecycle.delete(current.id)
    expect(deleteTrace).toHaveBeenCalledWith(current.id)
  })

  it('trace 清理失败不改变已经完成的会话删除结果', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const lifecycle = createConversationLifecycle({
      data: {
        conversationRepository: { delete: vi.fn(async () => true) },
        messageRepository: {},
        loadAttachmentData: vi.fn(),
        workspaceService: {},
      } as never,
      events: new RuntimeEventBus(),
      runtime: { closeConversation: vi.fn(), listActiveTasks: vi.fn(() => []) },
      observability: { deleteConversation: vi.fn(async () => { throw new Error('disk unavailable') }) },
      logger,
    })

    await expect(lifecycle.delete('conversation-1')).resolves.toEqual(['conversation-1'])
    expect(logger.warn).toHaveBeenCalled()
  })

  it('取消归档失败时撤销刚恢复的工作区配置', async () => {
    const archived = conversation({ archived: true })
    const addWorkspace = vi.fn()
    const removeWorkspace = vi.fn()
    const lifecycle = createConversationLifecycle({
      data: {
        conversationRepository: {
          getById: vi.fn(async () => archived),
          setArchived: vi.fn(async () => { throw new Error('database unavailable') }),
        },
        messageRepository: {},
        loadAttachmentData: vi.fn(),
        workspaceService: {
          isWorkspaceAvailable: vi.fn(() => true),
          listWorkspaces: vi.fn(() => ({ workspaces: [] })),
          addWorkspace,
          removeWorkspace,
        },
      } as never,
      events: new RuntimeEventBus(),
      runtime: { closeConversation: vi.fn(), listActiveTasks: vi.fn(() => []) },
    })

    await expect(lifecycle.restore(archived.id)).rejects.toThrow('database unavailable')
    expect(addWorkspace).toHaveBeenCalledWith('/workspace')
    expect(removeWorkspace).toHaveBeenCalledWith('/workspace')
  })

  it('fork 复制消息和 visualization，失败时不留下半成品会话', async () => {
    const source = conversation({ id: 'source', title: '源会话' })
    const fork = conversation({ id: 'fork', title: '源会话 副本' })
    const sourceMessage = {
      id: 'message-1',
      convId: source.id,
      role: 'assistant',
      status: 'success',
      content: [{
        type: 'visualization',
        format: 'ant-chat.visualization.html.v1',
        source: { type: 'file_id', file_id: 'missing-artifact' },
      }],
    } as IMessage
    const repository = {
      getById: vi.fn(async () => source),
      create: vi.fn(async () => fork),
      delete: vi.fn(async () => true),
    }
    const lifecycle = createConversationLifecycle({
      data: {
        conversationRepository: repository,
        messageRepository: {
          listByConversation: vi.fn(async () => [sourceMessage]),
          create: vi.fn(),
        },
        loadAttachmentData: vi.fn(async () => null),
        workspaceService: {} as never,
      } as never,
      events: new RuntimeEventBus(),
      runtime: { closeConversation: vi.fn(), listActiveTasks: vi.fn(() => []) },
      now: () => 2,
      randomId: () => 'new-id',
    })

    await expect(lifecycle.fork({ sourceConversationId: source.id, workspacePath: '/workspace' }))
      .rejects
      .toThrow('可视化 artifact 不存在：missing-artifact')
    expect(repository.delete).toHaveBeenCalledWith(fork.id)
  })

  it('fork 只复制会话与消息，不复制或删除 Trace', async () => {
    const source = conversation({ id: 'source', title: '源会话' })
    const fork = conversation({ id: 'fork', title: '源会话 副本' })
    const deleteTrace = vi.fn(async () => {})
    const lifecycle = createConversationLifecycle({
      data: {
        conversationRepository: {
          getById: vi.fn(async () => source),
          create: vi.fn(async () => fork),
        },
        messageRepository: {
          listByConversation: vi.fn(async () => []),
          create: vi.fn(async input => ({ ...input, id: 'event-1' })),
        },
        loadAttachmentData: vi.fn(),
        workspaceService: {},
      } as never,
      events: new RuntimeEventBus(),
      runtime: { closeConversation: vi.fn(), listActiveTasks: vi.fn(() => []) },
      observability: { deleteConversation: deleteTrace },
    })

    await expect(lifecycle.fork({ sourceConversationId: source.id, workspacePath: '/workspace' })).resolves.toEqual(fork)
    expect(deleteTrace).not.toHaveBeenCalled()
  })
})

function conversation(overrides: Partial<IConversations>): IConversations {
  return {
    id: 'conversation-1',
    title: '会话',
    workspacePath: '/workspace',
    conversationInstructions: '',
    archived: false,
    createdAt: 1,
    updatedAt: 1,
    settings: {
      providerId: 'provider-1',
      modelId: 'model-1',
    },
    ...overrides,
  }
}
