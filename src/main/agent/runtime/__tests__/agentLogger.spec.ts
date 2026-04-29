import fs from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { appendAgentLog } from '../agentLogger'

afterEach(async () => {
  await fs.rm(path.join(process.cwd(), 'agent'), { recursive: true, force: true }).catch(() => {})
})

describe('agentLogger', () => {
  it('写入结构化日志且做脱敏与截断', async () => {
    const logPath = await appendAgentLog('task-log-1', 'tool_completed', {
      apiKey: 'sk-1234567890abcdefghijklmnopqrstuvwxyz',
      envToken: 'abc',
      longText: 'x'.repeat(600),
    })
    const content = await fs.readFile(logPath, 'utf8')
    expect(content).toContain('"event":"tool_completed"')
    expect(content).toContain('"apiKey":"***"')
    expect(content).toContain('"envToken":"***"')
    expect(content).toContain('truncated')
  })
})
