import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createAgentBrowserPaths, getAgentBrowserBinaryName, resolveAgentBrowserExecutablePath } from '../agentBrowser'

describe('agentBrowser paths', () => {
  it('uses one global Ant Chat profile and artifacts directory', () => {
    expect(createAgentBrowserPaths('/home/user')).toEqual({
      profilePath: path.join('/home/user', '.ant-chat', 'browser', 'profile'),
      artifactsPath: path.join('/home/user', '.ant-chat', 'browser', 'artifacts'),
    })
  })

  it('maps supported platforms to the packaged agent-browser binary', () => {
    expect(getAgentBrowserBinaryName('darwin', 'arm64')).toBe('agent-browser-darwin-arm64')
    expect(getAgentBrowserBinaryName('darwin', 'x64')).toBe('agent-browser-darwin-x64')
    expect(getAgentBrowserBinaryName('linux', 'x64')).toBe('agent-browser-linux-x64')
    expect(getAgentBrowserBinaryName('win32', 'x64')).toBe('agent-browser-win32-x64.exe')
    expect(() => getAgentBrowserBinaryName('win32', 'arm64')).toThrow('Unsupported agent-browser platform')
  })

  it('resolves the packaged resource path', () => {
    expect(resolveAgentBrowserExecutablePath({
      resourcesPath: '/app/resources',
      platform: 'darwin',
      arch: 'arm64',
    })).toBe(path.join('/app/resources', 'agent-browser', 'agent-browser'))
    expect(resolveAgentBrowserExecutablePath({
      resourcesPath: 'C:\\app\\resources',
      platform: 'win32',
      arch: 'x64',
    })).toBe(path.join('C:\\app\\resources', 'agent-browser', 'agent-browser.exe'))
  })
})
