import { z } from 'zod'

export const BaseMcpConfig = z.object({
  /** 持久化身份；显示名、配置 key 和权限展示都不得承担该职责。 */
  serverId: z.uuid({ error: 'serverId 必须是有效 UUID' }),
  serverName: z.string({ error: 'serverName 是必填项' }),
  description: z.string().optional().nullable(),
  timeout: z.number().optional(),
  transportType: z.enum(['stdio', 'streamable-http']),
  /** 是否启用：禁用后不随应用启动自动连接，也不会保持运行。 */
  enabled: z.boolean().default(true),
})

export const StreamableHttpMcpConfig = BaseMcpConfig.extend({
  transportType: z.literal('streamable-http'),
  url: z.url({ error: 'url格式错误' }),
  headers: z.record(z.string(), z.string()).optional(),
  /** 认证类型：不传或 'none' 表示无需认证，'oauth' 表示使用 OAuth 2.0 */
  authType: z.enum(['none', 'oauth']).optional(),
})

export type StreamableHttpMcpConfig = z.infer<typeof StreamableHttpMcpConfig>

export const StdioMcpConfig = BaseMcpConfig.extend({
  transportType: z.literal('stdio'),
  command: z.string({ error: '缺少command参数' }),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.any()).optional(),
})

export type StdioMcpConfig = z.infer<typeof StdioMcpConfig>

export const AddMcpConfigSchema = z.discriminatedUnion('transportType', [
  StreamableHttpMcpConfig.omit({ serverId: true }),
  StdioMcpConfig.omit({ serverId: true }),
])
export type AddMcpConfigSchema = z.infer<typeof AddMcpConfigSchema>

export const McpConfigSchema = z.discriminatedUnion('transportType', [StreamableHttpMcpConfig, StdioMcpConfig])
export type McpConfigSchema = z.infer<typeof McpConfigSchema>

export const McpSettingsSchema = z.object({
  servers: z.record(z.string(), McpConfigSchema),
})

export type McpSettingsSchema = z.infer<typeof McpSettingsSchema>

export const UpdateMcpConfigSchema = z.discriminatedUnion('transportType', [
  StreamableHttpMcpConfig.omit({ serverId: true }).partial().extend({ serverName: z.string(), transportType: z.literal('streamable-http') }),
  StdioMcpConfig.omit({ serverId: true }).partial().extend({ serverName: z.string(), transportType: z.literal('stdio') }),
])

export type UpdateMcpConfigSchema = z.infer<typeof UpdateMcpConfigSchema>

/** MCP 生命周期 module 接收的编辑 patch；最终完整配置由 module 合并并校验。 */
export interface McpServerEditPatch {
  serverName?: string
  description?: string | null
  timeout?: number
  transportType?: 'stdio' | 'streamable-http'
  enabled?: boolean
  command?: string
  args?: string[]
  env?: Record<string, unknown>
  url?: string
  headers?: Record<string, string>
  authType?: 'none' | 'oauth'
}
