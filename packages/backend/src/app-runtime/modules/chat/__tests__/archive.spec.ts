import { describe, expect, it, vi } from 'vitest'
import { ChatModule } from '../index'

describe('会话归档运行状态保护', () => {
  it('任务运行中时拒绝归档且不修改持久化状态', async () => {
    const setArchived = vi.fn()
    const module = new ChatModule(
      {
        data: { conversationRepository: { setArchived } },
        events: { emit: vi.fn() },
      } as never,
      {
        listActiveTasks: vi.fn(() => [{ taskId: 'running-task' }]),
      } as never,
      {} as never,
    )

    await expect(module.archiveConversation({ id: 'conversation-1' }))
      .rejects
      .toThrow('任务运行中，暂时无法归档')
    expect(setArchived).not.toHaveBeenCalled()
  })

  it('将无工作区的归档会话归类为未关联工作区', async () => {
    const conversation = {
      id: 'conversation-1',
      workspacePath: null,
      title: '旧会话',
      createdAt: 1,
      updatedAt: 1,
      archived: true,
      settings: {},
    }
    const listArchived = vi.fn().mockResolvedValue({ data: [conversation], total: 1 })
    const isWorkspaceAvailable = vi.fn()
    const module = new ChatModule(
      {
        data: {
          conversationRepository: {
            listArchivedWorkspaces: vi.fn().mockResolvedValue([{ workspacePath: null, total: 1 }]),
            listArchived,
          },
          workspaceService: {
            listWorkspaces: vi.fn().mockReturnValue({ workspaces: [] }),
            isWorkspaceAvailable,
          },
        },
        events: { emit: vi.fn() },
      } as never,
      {} as never,
      {} as never,
    )

    await expect(module.getArchivedConversationWorkspaces({ pageSize: 20 })).resolves.toEqual({
      total: 1,
      workspaces: [{
        workspacePath: null,
        displayName: '未关联工作区',
        total: 1,
        matchedTotal: 1,
        available: false,
        conversations: [conversation],
      }],
    })
    expect(listArchived).toHaveBeenCalledWith(0, 20, null, '')
    expect(isWorkspaceAvailable).not.toHaveBeenCalled()
  })
})
