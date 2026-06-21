import os from 'node:os'
import path from 'node:path'

const APP_DIR = '.ant-chat'

/**
 * Application data root directory.
 *
 * - production:     ~/.ant-chat
 */
export function resolveAppDataRoot(): string {
  return path.join(os.homedir(), APP_DIR)
}
