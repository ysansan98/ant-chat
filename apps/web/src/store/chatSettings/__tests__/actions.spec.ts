/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  updateTaskMode: vi.fn(),
  getActiveTask: vi.fn(),
  getMessagesState: vi.fn(),
  toastInfo: vi.fn(),
  toastWarning: vi.fn(),
}))

vi.mock('@/api/agentApi', () => ({
  default: {
    updateTaskMode: mocks.updateTaskMode,
  },
}))

vi.mock('@/store/agentRuntime', () => ({
  getActiveTask: mocks.getActiveTask,
}))

vi.mock('@/store/messages', () => ({
  useMessagesStore: {
    getState: mocks.getMessagesState,
  },
}))

vi.mock('sonner', () => ({
  toast: {
    info: mocks.toastInfo,
    warning: mocks.toastWarning,
  },
}))

import { setAgentMode } from '../actions'
import { useChatSttingsStore } from '../store'

describe('chatSettings actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useChatSttingsStore.setState({ agentMode: 'hybrid' })
    mocks.getMessagesState.mockReturnValue({ activeConversationsId: 'conversation-1' })
    mocks.getActiveTask.mockReturnValue({ taskId: 'task-1' })
  })

  it('运行中切换成功时提示后续工具按新权限生效', async () => {
    mocks.updateTaskMode.mockResolvedValue({ taskId: 'task-1', mode: 'strict' })

    setAgentMode('strict')
    await mocks.updateTaskMode.mock.results[0].value

    expect(useChatSttingsStore.getState().agentMode).toBe('strict')
    expect(mocks.toastInfo).toHaveBeenCalledWith('已切换，后续工具调用按新权限生效')
    expect(mocks.toastWarning).not.toHaveBeenCalled()
  })

  it('运行中切换失败时提示当前 Turn 未应用且下轮生效', async () => {
    mocks.updateTaskMode.mockRejectedValue(new Error('network'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    setAgentMode('strict')
    await vi.waitFor(() => expect(mocks.toastWarning).toHaveBeenCalledWith('权限切换未应用到当前 turn，下轮生效'))

    errorSpy.mockRestore()
  })
})
