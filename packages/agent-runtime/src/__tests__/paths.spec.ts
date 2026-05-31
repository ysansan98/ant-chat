import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createAgentRuntimePaths } from '../paths'

describe('createAgentRuntimePaths', () => {
  it('derives runtime paths from one root', () => {
    const paths = createAgentRuntimePaths('/data/ant-chat')

    expect(paths).toEqual({
      root: '/data/ant-chat',
      databaseFile: path.join('/data/ant-chat', 'ant-chat.db'),
      settingsFile: path.join('/data/ant-chat', 'settings.json'),
      mcpSettingsFile: path.join('/data/ant-chat', 'mcp.json'),
      memoryRoot: path.join('/data/ant-chat', 'agent-memory'),
      workspaceSettingsFile: path.join('/data/ant-chat', 'workspace.json'),
      skillsRoot: path.join('/data/ant-chat', 'skills'),
      logsRoot: path.join('/data/ant-chat', 'logs'),
      taskLogsRoot: path.join('/data/ant-chat', 'logs', 'tasks'),
    })
  })

  it('uses one database file name for every host', () => {
    const paths = createAgentRuntimePaths('/data/ant-chat')

    expect(paths.databaseFile).toBe(path.join('/data/ant-chat', 'ant-chat.db'))
  })
})
