import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createAgentBrowserPaths } from '../agentBrowser'

describe('agentBrowser paths', () => {
  it('uses one global Ant Chat profile and artifacts directory', () => {
    expect(createAgentBrowserPaths(path.join('/home/user', '.ant-chat'))).toEqual({
      profilePath: path.join('/home/user', '.ant-chat', 'browser', 'profile'),
      artifactsPath: path.join('/home/user', '.ant-chat', 'browser', 'artifacts'),
    })
  })
})
