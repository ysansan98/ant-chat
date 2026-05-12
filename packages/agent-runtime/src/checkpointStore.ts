import type { AgentTaskSnapshot, IAgentPathProvider } from '@ant-chat/shared'
import fs from 'node:fs/promises'
import path from 'node:path'

export function createCheckpointStore(pathProvider: IAgentPathProvider) {
  async function writeCheckpoint(snapshot: AgentTaskSnapshot): Promise<string> {
    const root = pathProvider.getCheckpointsDir()
    await fs.mkdir(root, { recursive: true })
    const filePath = path.join(root, `${snapshot.taskId}.json`)
    const tmpPath = `${filePath}.tmp`
    snapshot.checkpointPath = filePath
    await fs.writeFile(tmpPath, JSON.stringify(snapshot, null, 2), 'utf8')
    await fs.rename(tmpPath, filePath)
    return filePath
  }

  async function removeCheckpoint(taskId: string): Promise<void> {
    const filePath = path.join(pathProvider.getCheckpointsDir(), `${taskId}.json`)
    await fs.rm(filePath, { force: true })
  }

  return { writeCheckpoint, removeCheckpoint }
}
