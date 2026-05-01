import { describe, expect, it } from 'vitest'
import { useAgentStore } from '@/store/agent/store'

describe('agentRecovery', () => {
  it('按 conversation 恢复 active task', () => {
    useAgentStore.setState({
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
          checkpointPath: '',
          logPath: '',
          prompt: 'p',
        },
      },
      pendingByTask: {},
    })

    const task = useAgentStore.getState().getActiveTaskByConversation('c1')
    expect(task?.taskId).toBe('t1')
  })
})
