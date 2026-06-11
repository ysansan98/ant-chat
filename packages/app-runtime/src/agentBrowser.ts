import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

const require = createRequire(import.meta.url)

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

export function getAgentBrowserBinaryName(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  if (platform === 'darwin' && (arch === 'arm64' || arch === 'x64')) {
    return `agent-browser-darwin-${arch}`
  }
  if (platform === 'linux' && (arch === 'arm64' || arch === 'x64')) {
    return `agent-browser-linux-${arch}`
  }
  if (platform === 'win32' && arch === 'x64') {
    return 'agent-browser-win32-x64.exe'
  }
  throw new Error(`Unsupported agent-browser platform: ${platform}-${arch}`)
}

export function resolveAgentBrowserExecutablePath(options: {
  resourcesPath?: string
  platform?: NodeJS.Platform
  arch?: string
} = {}): string {
  if (options.resourcesPath) {
    const executableName = options.platform === 'win32' || (!options.platform && process.platform === 'win32')
      ? 'agent-browser.exe'
      : 'agent-browser'
    return path.join(options.resourcesPath, 'agent-browser', executableName)
  }

  const packageJsonPath = require.resolve('agent-browser/package.json')
  return path.join(
    path.dirname(packageJsonPath),
    'bin',
    getAgentBrowserBinaryName(options.platform, options.arch),
  )
}
