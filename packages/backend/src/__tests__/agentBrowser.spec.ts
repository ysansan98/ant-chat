import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createAgentBrowserPaths } from '../agentBrowser'

describe('agentBrowser paths', () => {
  it('只保留浏览器输出目录，不再生成托管 profile 路径', () => {
    expect(createAgentBrowserPaths(path.join('/home/user', '.ant-chat'))).toEqual({
      artifactsPath: path.join('/home/user', '.ant-chat', 'browser', 'artifacts'),
    })
  })
})
