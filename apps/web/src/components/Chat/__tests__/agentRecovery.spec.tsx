import { describe, expect, it } from 'vitest'
import { useAgentRuntimeStore } from '@/store/agentRuntime'

describe('agentRecovery', () => {
  it('按 conversation 恢复 active task', () => {
    useAgentRuntimeStore.setState({
      tasks: {
        t1: {
          taskId: 't1',
          conversationId: 'c1',
          userMessageId: 'm1',
          workspacePath: '/tmp/ws',
          mode: 'hybrid',
          status: 'awaiting_approval',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          prompt: 'p',
        },
      },
      pendingByTask: {},
    })

    const task = useAgentRuntimeStore.getState().getActiveTaskByConversation('c1')
    expect(task?.taskId).toBe('t1')
  })
})
