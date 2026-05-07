import type { AgentTaskSnapshot } from '@ant-chat/shared'
import fs from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanupTempRuntimeDataRoot, createTempRuntimeDataRoot } from '../../../../../tests/helpers/runtimeData'
import { removeCheckpoint, writeCheckpoint } from '../checkpointStore'

function createSnapshot(taskId: string): AgentTaskSnapshot {
  const now = Date.now()
  return {
    taskId,
    conversationId: 'c1',
    userMessageId: 'm1',
    workspacePath: '/tmp/ws',
    mode: 'hybrid',
    status: 'running',
    createdAt: now,
    updatedAt: now,
    checkpointPath: '',
    logPath: '',
    prompt: 'p',
  }
}

let runtimeRoot: string

beforeEach(async () => {
  runtimeRoot = await createTempRuntimeDataRoot()
})

afterEach(async () => {
  await cleanupTempRuntimeDataRoot(runtimeRoot)
})

describe('checkpointStore', () => {
  it('写入并删除 checkpoint', async () => {
    const filePath = await writeCheckpoint(createSnapshot('t1'))
    expect(filePath.startsWith(runtimeRoot)).toBe(true)
    const content = await fs.readFile(filePath, 'utf8')
    expect(content).toContain('"taskId": "t1"')
    expect(content).toContain('"checkpointPath":')
    await removeCheckpoint('t1')
    await expect(fs.stat(filePath)).rejects.toThrow()
  })
})
