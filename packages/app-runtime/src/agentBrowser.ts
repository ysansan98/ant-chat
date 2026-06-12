import os from 'node:os'
import path from 'node:path'

export interface AgentBrowserPaths {
  profilePath: string
  artifactsPath: string
}

export function createAgentBrowserPaths(homeDir: string = os.homedir()): AgentBrowserPaths {
  const root = path.join(homeDir, '.ant-chat', 'browser')
  return {
    profilePath: path.join(root, 'profile'),
    artifactsPath: path.join(root, 'artifacts'),
  }
}
