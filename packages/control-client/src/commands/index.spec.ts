import type { AppControlCommand } from '@ant-chat/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { executeCommand } from './index'

function createClient(result: object = { deleted: true }) {
  return {
    send: vi.fn(async (_command: AppControlCommand) => ({ ok: true as const, result })),
  }
}

describe('ant-chat CLI 命令', () => {
  const envKeys = ['ANT_CHAT_PROVIDER_API_KEY', 'ANT_CHAT_TEST_MCP_AUTHORIZATION', 'ANT_CHAT_TEST_MCP_API_KEY']

  afterEach(() => {
    for (const key of envKeys) {
      delete process.env[key]
    }
  })

  it('将文档中的 kebab-case provider 参数转换为控制命令', async () => {
    const client = createClient({ provider: { id: 'provider-1', name: 'OpenAI' } })

    const result = await executeCommand(client as never, [
      'provider',
      'create',
      '--name=OpenAI',
      '--base-url=https://api.openai.com/v1',
      '--api-mode=openai',
    ], { json: true })

    expect(result.exitCode).toBe(0)
    expect(client.send).toHaveBeenCalledWith(expect.objectContaining({
      action: 'create',
      apiMode: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      name: 'OpenAI',
      type: 'provider',
    }))
  })

  it('将自动化的调度与上下文参数完整传给控制面', async () => {
    const client = createClient({ automation: { id: 'automation-1' } })

    const result = await executeCommand(client as never, [
      'automation',
      'create',
      '--name=日报',
      '--prompt=生成日报',
      '--workspace-path=/workspace',
      '--provider-id=provider-1',
      '--model-id=model-1',
      '--schedule-type=once',
      '--run-at=1712345678000',
      '--allowed-skills=writer,review',
      '--allowed-mcp-servers=filesystem',
    ], { json: true })

    expect(result.exitCode).toBe(0)
    expect(client.send).toHaveBeenCalledWith({
      action: 'create',
      enabled: true,
      modelId: 'model-1',
      name: '日报',
      prompt: '生成日报',
      providerId: 'provider-1',
      schedule: { runAt: 1712345678000, type: 'once' },
      allowedMcpServers: ['filesystem'],
      allowedSkills: ['writer', 'review'],
      type: 'automation',
      workspacePath: '/workspace',
    })
  })

  it('允许外部 CLI 显式提交真实 API Key', async () => {
    const client = createClient({ hasApiKey: true, id: 'provider-1' })

    const result = await executeCommand(client as never, [
      'provider',
      'key',
      'set',
      'provider-1',
      '--api-key=sk-local',
    ], { json: true })

    expect(result.exitCode).toBe(0)
    expect(client.send).toHaveBeenCalledWith({
      action: 'key:set',
      apiKey: 'sk-local',
      id: 'provider-1',
      type: 'provider',
    })
  })

  it('允许 Skill 通过 bash.secretEnv 给 provider key:set 注入 API Key', async () => {
    process.env.ANT_CHAT_PROVIDER_API_KEY = 'sk-from-env'
    const client = createClient({ hasApiKey: true, id: 'provider-1' })

    const result = await executeCommand(client as never, [
      'provider',
      'key',
      'set',
      'provider-1',
    ], { json: true })

    expect(result.exitCode).toBe(0)
    expect(client.send).toHaveBeenCalledWith({
      action: 'key:set',
      apiKey: 'sk-from-env',
      id: 'provider-1',
      type: 'provider',
    })
  })

  it('允许 Skill 通过 bash.secretEnv 给 SSE MCP headers 注入敏感值', async () => {
    process.env.ANT_CHAT_TEST_MCP_AUTHORIZATION = 'Bearer secret'
    const client = createClient({ mcpServer: { name: 'remote', status: 'connected' } })

    const result = await executeCommand(client as never, [
      'mcp',
      'install',
      '--name=remote',
      '--transport-type=sse',
      '--url=https://example.com/mcp',
      '--headers-from-env=Authorization=ANT_CHAT_TEST_MCP_AUTHORIZATION',
    ], { json: true })

    expect(result.exitCode).toBe(0)
    expect(client.send).toHaveBeenCalledWith(expect.objectContaining({
      action: 'install',
      headers: { Authorization: 'Bearer secret' },
      serverName: 'remote',
      type: 'mcp',
    }))
  })

  it('更新 provider 时转换 kebab-case 参数和布尔值', async () => {
    const client = createClient({ provider: { id: 'provider-1' } })

    const result = await executeCommand(client as never, [
      'provider',
      'update',
      'provider-1',
      '--base-url=https://example.com/v1',
      '--api-mode=anthropic',
      '--is-enabled=false',
    ], { json: true })

    expect(result.exitCode).toBe(0)
    expect(client.send).toHaveBeenCalledWith({
      action: 'update',
      apiMode: 'anthropic',
      baseUrl: 'https://example.com/v1',
      id: 'provider-1',
      isEnabled: false,
      type: 'provider',
    })
  })
})
