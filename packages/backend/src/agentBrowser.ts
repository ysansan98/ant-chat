import os from 'node:os'
import path from 'node:path'

export interface AgentBrowserPaths {
  artifactsPath: string
}

export interface BrowserIdentityPaths extends AgentBrowserPaths {
  root: string
  sessionsPath: string
  identityPath: string
  cookiesPath: string
}

export function createAgentBrowserPaths(appDataRoot: string = path.join(os.homedir(), '.ant-chat')): AgentBrowserPaths {
  const root = path.join(appDataRoot, 'browser')
  return {
    artifactsPath: path.join(root, 'artifacts'),
  }
}

export function createBrowserIdentityPaths(appDataRoot: string = path.join(os.homedir(), '.ant-chat')): BrowserIdentityPaths {
  const root = path.join(appDataRoot, 'browser')
  const browserPaths = createAgentBrowserPaths(appDataRoot)
  return {
    root,
    ...browserPaths,
    sessionsPath: path.join(root, 'sessions'),
    identityPath: path.join(root, 'identity.json'),
    cookiesPath: path.join(root, 'cookies.enc'),
  }
}
