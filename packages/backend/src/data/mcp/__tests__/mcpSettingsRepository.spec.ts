import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
      enabled: true,
      serverName: 'local',
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
    expect(created.serverId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    expect(repository.getMcpConfigByServerName('local')).toEqual(created)

    const updated = repository.replaceMcpConfig('local', {
      enabled: true,
      serverName: 'local',
      transportType: 'stdio',
      command: 'bun',
      args: ['server.js'],
      env: { NODE_ENV: 'test' },
      description: 'Local server',
    })
    expect(updated).toEqual(expect.objectContaining({
      serverName: 'local',
      serverId: created.serverId,
      command: 'bun',
      args: ['server.js'],
    }))

    expect(repository.deleteMcpConfig('local')).toBe(true)
    expect(repository.getMcpConfigs()).toEqual([])
  })

  it('迁移旧版 sse 配置后持久化为明确的 Streamable HTTP 语义', () => {
    const filePath = path.join(dir, 'legacy-mcp.json')
    writeFileSync(filePath, JSON.stringify({
      schemaVersion: 1,
      data: {
        servers: {
          remote: {
            serverName: 'remote',
            transportType: 'sse',
            url: 'https://mcp.example.com',
          },
        },
      },
    }), 'utf8')

    const legacyRepository = new McpSettingsRepository(new McpSettingsStore({ filePath }))

    expect(legacyRepository.getMcpConfigByServerName('remote')).toEqual(expect.objectContaining({
      serverName: 'remote',
      serverId: expect.stringMatching(/^[0-9a-f-]{36}$/i),
      transportType: 'streamable-http',
      url: 'https://mcp.example.com',
    }))
    expect(JSON.parse(readFileSync(filePath, 'utf8'))).toEqual(expect.objectContaining({
      schemaVersion: 2,
      data: expect.objectContaining({
        servers: expect.objectContaining({
          remote: expect.objectContaining({ transportType: 'streamable-http' }),
        }),
      }),
    }))
  })

  it('重命名 server 时保留稳定身份', () => {
    const created = repository.addMcpConfig({
      enabled: true,
      serverName: 'before',
      transportType: 'streamable-http',
      url: 'https://mcp.example.com',
    })

    const renamed = repository.replaceMcpConfig('before', {
      enabled: true,
      serverName: 'after',
      transportType: 'streamable-http',
      url: 'https://mcp.example.com',
    })

    expect(renamed.serverId).toBe(created.serverId)
    expect(repository.getMcpConfigByServerId(created.serverId)).toEqual(renamed)
    expect(repository.getMcpConfigByServerName('before')).toBeNull()
  })

  it('resets invalid existing MCP settings when requested', () => {
    const filePath = path.join(dir, 'invalid-mcp.json')
    writeFileSync(filePath, JSON.stringify({ configs: [] }), 'utf8')

    const store = new McpSettingsStore({ filePath, resetInvalidFile: true })

    expect(store.read()).toEqual({ servers: {} })
  })
})
