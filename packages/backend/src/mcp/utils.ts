import os from 'node:os'

export function getCurrentPlatform() {
  return os.platform()
}
