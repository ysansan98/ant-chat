import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

const APP_DIR = '.ant-chat'

/**
 * Walk up from `start` looking for pnpm-workspace.yaml.
 * Returns the directory containing it, or `start` if not found.
 */
export function findWorkspaceRoot(start: string): string {
  let current = start
  while (true) {
    if (fs.existsSync(path.join(current, 'pnpm-workspace.yaml'))) {
      return current
    }

    const parent = path.dirname(current)
    if (parent === current) {
      return start
    }
    current = parent
  }
}

/**
 * Application data root directory.
 *
 * - non-production: <workspace-root>/.ant-chat
 * - production:     ~/.ant-chat
 */
export function resolveAppDataRoot(): string {
  if (process.env.NODE_ENV === 'production') {
    return path.join(os.homedir(), APP_DIR)
  }

  return path.join(findWorkspaceRoot(process.cwd()), APP_DIR)
}
