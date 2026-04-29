import type { AgentTaskSnapshot } from '@ant-chat/shared'
import fs from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
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
    progress: [],
  }
}

afterEach(async () => {
  await fs.rm(path.join(process.cwd(), 'agent'), { recursive: true, force: true })
})

describe('checkpointStore', () => {
  it('写入并删除 checkpoint', async () => {
    const filePath = await writeCheckpoint(createSnapshot('t1'))
    const content = await fs.readFile(filePath, 'utf8')
    expect(content).toContain('"taskId": "t1"')
    await removeCheckpoint('t1')
    await expect(fs.stat(filePath)).rejects.toThrow()
  })
})
