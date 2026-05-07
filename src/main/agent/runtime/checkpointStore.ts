import type { AgentTaskSnapshot } from '@ant-chat/shared'
import fs from 'node:fs/promises'
import path from 'node:path'
import { getAgentTasksDir } from '@main/utils/appPaths'

export async function writeCheckpoint(snapshot: AgentTaskSnapshot): Promise<string> {
  const root = getAgentTasksDir()
  await fs.mkdir(root, { recursive: true })
  const filePath = path.join(root, `${snapshot.taskId}.json`)
  const tmpPath = `${filePath}.tmp`
  snapshot.checkpointPath = filePath
  await fs.writeFile(tmpPath, JSON.stringify(snapshot, null, 2), 'utf8')
  await fs.rename(tmpPath, filePath)
  return filePath
}

export async function removeCheckpoint(taskId: string): Promise<void> {
  const filePath = path.join(getAgentTasksDir(), `${taskId}.json`)
  await fs.rm(filePath, { force: true })
}
