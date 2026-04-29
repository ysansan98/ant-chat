import { describe, expect, it } from 'vitest'
import { shouldStartAgentTask } from '../agentRouting'

describe('agentRouting', () => {
  it('简单问题走普通聊天', () => {
    expect(shouldStartAgentTask('今天星期几？', [])).toBe(false)
  })

  it('复杂任务进入 agent', () => {
    expect(shouldStartAgentTask('检查当前项目并总结结构', [])).toBe(true)
  })
})
