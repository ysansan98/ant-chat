import type { AgentTaskSnapshot } from '@ant-chat/shared'
import fs from 'node:fs/promises'
import path from 'node:path'

const CHECKPOINT_ROOT = path.join(process.cwd(), 'agent', 'tasks')

export async function writeCheckpoint(snapshot: AgentTaskSnapshot): Promise<string> {
  await fs.mkdir(CHECKPOINT_ROOT, { recursive: true })
  const filePath = path.join(CHECKPOINT_ROOT, `${snapshot.taskId}.json`)
  const tmpPath = `${filePath}.tmp`
  await fs.writeFile(tmpPath, JSON.stringify(snapshot, null, 2), 'utf8')
  await fs.rename(tmpPath, filePath)
  return filePath
}

export async function removeCheckpoint(taskId: string): Promise<void> {
  const filePath = path.join(CHECKPOINT_ROOT, `${taskId}.json`)
  await fs.rm(filePath, { force: true })
}
