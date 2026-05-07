import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

const RUNTIME_DIR_ENV = 'ANT_CHAT_RUNTIME_DIR'

export async function createTempRuntimeDataRoot(prefix = 'ant-chat-runtime-'): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  process.env[RUNTIME_DIR_ENV] = root
  return root
}

export async function cleanupTempRuntimeDataRoot(root?: string): Promise<void> {
  delete process.env[RUNTIME_DIR_ENV]
  if (root) {
    await fs.rm(root, { recursive: true, force: true })
  }
}
