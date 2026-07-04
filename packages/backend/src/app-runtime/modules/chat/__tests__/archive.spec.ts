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
})
