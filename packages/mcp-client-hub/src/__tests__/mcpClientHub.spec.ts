import { describe, expect, it } from 'vitest'
import { DEFAULT_MCP_TIMEOUT_SECONDS, resolveMcpToolTimeoutMs } from '../schema'

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
