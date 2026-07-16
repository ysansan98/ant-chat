import { z } from 'zod'

export const BaseMcpConfig = z.object({
  serverName: z.string({ error: 'serverName 是必填项' }),
  icon: z.string(),
  description: z.string().optional().nullable(),
  timeout: z.number().optional(),
  transportType: z.enum(['stdio', 'sse']),
})

export const SSEMcpConfig = BaseMcpConfig.extend({
  transportType: z.literal('sse'),
  url: z.url({ error: 'url格式错误' }),
  headers: z.record(z.string(), z.string()).optional(),
})

export type SSEMcpConfig = z.infer<typeof SSEMcpConfig>

export const StdioMcpConfig = BaseMcpConfig.extend({
  transportType: z.literal('stdio'),
  command: z.string({ error: '缺少command参数' }),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.any()).optional(),
})

export type StdioMcpConfig = z.infer<typeof StdioMcpConfig>

export const AddMcpConfigSchema = z.discriminatedUnion('transportType', [
  SSEMcpConfig,
  StdioMcpConfig,
])
export type AddMcpConfigSchema = z.infer<typeof AddMcpConfigSchema>

export const McpConfigSchema = z.discriminatedUnion('transportType', [SSEMcpConfig, StdioMcpConfig])
export type McpConfigSchema = z.infer<typeof McpConfigSchema>

export const McpSettingsSchema = z.object({
  servers: z.record(z.string(), McpConfigSchema),
})

export type McpSettingsSchema = z.infer<typeof McpSettingsSchema>

export const UpdateMcpConfigSchema = z.discriminatedUnion('transportType', [
  SSEMcpConfig.partial().extend({ serverName: z.string(), transportType: z.literal('sse') }),
  StdioMcpConfig.partial().extend({ serverName: z.string(), transportType: z.literal('stdio') }),
])

export type UpdateMcpConfigSchema = z.infer<typeof UpdateMcpConfigSchema>

/** MCP 生命周期 module 接收的编辑 patch；最终完整配置由 module 合并并校验。 */
export interface McpServerEditPatch {
  serverName?: string
  icon?: string
  description?: string | null
  timeout?: number
  transportType?: 'stdio' | 'sse'
  command?: string
  args?: string[]
  env?: Record<string, unknown>
  url?: string
  headers?: Record<string, string>
}
