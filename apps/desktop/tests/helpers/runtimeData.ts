import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

const APP_DATA_DIR_ENV = 'ANT_CHAT_APP_DATA_DIR'

export async function createTempRuntimeDataRoot(prefix = 'ant-chat-runtime-'): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  process.env[APP_DATA_DIR_ENV] = root
  return root
}

export async function cleanupTempRuntimeDataRoot(root?: string): Promise<void> {
  delete process.env[APP_DATA_DIR_ENV]
  if (root) {
    await fs.rm(root, { recursive: true, force: true })
  }
}
