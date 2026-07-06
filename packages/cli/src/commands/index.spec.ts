import type { AppControlCommand } from '@ant-chat/shared'
import { describe, expect, it, vi } from 'vitest'
import { executeCommand } from './index'

function createClient(result: object = { deleted: true }) {
  return {
    send: vi.fn(async (_command: AppControlCommand) => ({ ok: true as const, result })),
  }
}

describe('ant-chat CLI 命令', () => {
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
      '--selected-skills=writer,review',
      '--selected-mcp-servers=filesystem',
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
      selectedMcpServers: ['filesystem'],
      selectedSkills: ['writer', 'review'],
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
