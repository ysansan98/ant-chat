import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { McpSettingsRepository } from '../mcpSettingsRepository'
import { McpSettingsStore } from '../mcpSettingsStore'

describe('mcp settings repository', () => {
  let dir: string
  let repository: McpSettingsRepository

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'ant-chat-mcp-settings-'))
    repository = new McpSettingsRepository(new McpSettingsStore({
      filePath: path.join(dir, 'mcp.json'),
    }))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('adds, updates, and deletes MCP configs by server name', () => {
    const created = repository.addMcpConfig({
      serverName: 'local',
      icon: 'L',
      description: 'Local server',
      transportType: 'stdio',
      command: 'node',
      args: ['server.js'],
      env: { NODE_ENV: 'test' },
    })

    expect(created).toEqual(expect.objectContaining({
      serverName: 'local',
      transportType: 'stdio',
      command: 'node',
    }))
    expect(repository.getMcpConfigByServerName('local')).toEqual(created)

    const updated = repository.updateMcpConfig({
      serverName: 'local',
      transportType: 'stdio',
      command: 'bun',
    })
    expect(updated).toEqual(expect.objectContaining({
      serverName: 'local',
      command: 'bun',
      args: ['server.js'],
    }))

    expect(repository.deleteMcpConfig('local')).toBe(true)
    expect(repository.getMcpConfigs()).toEqual([])
  })

  it('resets invalid existing MCP settings when requested', () => {
    const filePath = path.join(dir, 'invalid-mcp.json')
    writeFileSync(filePath, JSON.stringify({ configs: [] }), 'utf8')

    const store = new McpSettingsStore({ filePath, resetInvalidFile: true })

    expect(store.read()).toEqual({ servers: {} })
  })
})
