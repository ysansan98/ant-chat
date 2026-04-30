import type { McpConfigSchema as McpConfigSchemaType } from '@ant-chat/shared'
import { McpConfigSchema } from '@ant-chat/shared'
import { z } from 'zod'

export const DEFAULT_REQUEST_TIMEOUT_MS = 5000
export const DEFAULT_MCP_TIMEOUT_SECONDS = 10

export interface McpSettings {
  mcpServers: Record<string, McpConfigSchemaType>
}

export const McpSettingsSchema: z.ZodType<McpSettings> = z.object({
  mcpServers: z.record(z.string(), McpConfigSchema),
})
