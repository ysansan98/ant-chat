import type { McpConfigSchema as McpConfigSchemaType } from '@ant-chat/shared'
import { McpConfigSchema } from '@ant-chat/shared'
import { z } from 'zod'

export const DEFAULT_REQUEST_TIMEOUT_MS = 5000
export const DEFAULT_MCP_TIMEOUT_SECONDS = 10

/**
 * 把超时秒数转换成 MCP SDK 需要的毫秒。
 * 用空值合并选择默认值，保证 0 之类的合法数值不会被改写。
 * 秒到毫秒只转换一次，避免重复相乘导致默认值膨胀。
 */
export function resolveMcpToolTimeoutMs(timeoutSeconds?: number): number {
  return (timeoutSeconds ?? DEFAULT_MCP_TIMEOUT_SECONDS) * 1000
}

export interface McpSettings {
  mcpServers: Record<string, McpConfigSchemaType>
}

export const McpSettingsSchema: z.ZodType<McpSettings> = z.object({
  mcpServers: z.record(z.string(), McpConfigSchema),
})
