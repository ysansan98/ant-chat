import type { ILogger } from '@ant-chat/shared'
import { describe, expect, it, vi } from 'vitest'
import { MCPClientHub } from '../mcpClientHub'
import { DEFAULT_MCP_TIMEOUT_SECONDS, resolveMcpToolTimeoutMs } from '../schema'

function createMockLogger(): ILogger {
  return {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }
}

describe('resolveMcpToolTimeoutMs', () => {
  it('未传值时返回默认超时毫秒', () => {
    expect(resolveMcpToolTimeoutMs()).toBe(DEFAULT_MCP_TIMEOUT_SECONDS * 1000)
    expect(resolveMcpToolTimeoutMs()).toBe(10000)
  })

  it('传入整数秒时只转换一次', () => {
    expect(resolveMcpToolTimeoutMs(3)).toBe(3000)
  })

  it('传入小数秒时返回对应整数毫秒', () => {
    expect(resolveMcpToolTimeoutMs(0.5)).toBe(500)
  })
})

describe('mcpClientHub 日志行为', () => {
  it('删除连接失败时写入注入的运行日志', async () => {
    const logger = createMockLogger()
    const hub = new MCPClientHub(logger)
    hub.connections.push({
      client: { close: vi.fn() },
      server: {
        config: '{}',
        name: 'broken-server',
        status: 'connected',
      },
      transport: {
        close: vi.fn(async () => {
          throw new Error('close failed')
        }),
      },
    } as never)

    await expect(hub.deleteConnection('broken-server')).resolves.toBe(false)

    expect(logger.error).toHaveBeenCalledWith(
      'Failed to close transport for broken-server:',
      expect.any(Error),
    )
  })
})
