import fs from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanupTempRuntimeDataRoot, createTempRuntimeDataRoot } from '../../../../../tests/helpers/runtimeData'
import { appendAgentLog } from '../agentLogger'

let runtimeRoot: string

beforeEach(async () => {
  runtimeRoot = await createTempRuntimeDataRoot()
})

afterEach(async () => {
  await cleanupTempRuntimeDataRoot(runtimeRoot)
})

describe('agentLogger', () => {
  it('写入结构化日志且做脱敏与截断', async () => {
    const logPath = await appendAgentLog('task-log-1', 'tool_completed', {
      apiKey: 'sk-1234567890abcdefghijklmnopqrstuvwxyz',
      envToken: 'abc',
      longText: 'x'.repeat(600),
    })
    expect(logPath.startsWith(runtimeRoot)).toBe(true)
    const content = await fs.readFile(logPath, 'utf8')
    expect(content).toContain('"event":"tool_completed"')
    expect(content).toContain('"apiKey":"***"')
    expect(content).toContain('"envToken":"***"')
    expect(content).toContain('truncated')
  })
})
