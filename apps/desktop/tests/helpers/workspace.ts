import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export async function createTempWorkspace(prefix = 'ant-chat-workspace-'): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

export async function cleanupTempWorkspace(workspacePath?: string): Promise<void> {
  if (workspacePath) {
    await fs.rm(workspacePath, { recursive: true, force: true })
  }
}
