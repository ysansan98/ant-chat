import { z } from 'zod'

export const BaseMcpConfig = z.object({
  serverName: z.string({ message: 'serverName 是必填项' }),
  icon: z.string(),
  description: z.string().optional().nullable(),
  timeout: z.number().optional(),
  transportType: z.enum(['stdio', 'sse']),
  createdAt: z.number(),
  updatedAt: z.number(),
})

export const SSEMcpConfig = BaseMcpConfig.extend({
  transportType: z.literal('sse'),
  url: z.string({ message: 'url 是必填项' }).url({ message: 'url格式错误' }),
  headers: z.record(z.string()).optional(),
})

export type SSEMcpConfig = z.infer<typeof SSEMcpConfig>

export const StdioMcpConfig = BaseMcpConfig.extend({
  transportType: z.literal('stdio'),
  command: z.string({ message: '缺少command参数' }),
  args: z.array(z.string()).optional(),
  env: z.record(z.any()).optional(),
})

export type StdioMcpConfig = z.infer<typeof StdioMcpConfig>

export const AddMcpConfigSchema = z.discriminatedUnion('transportType', [
  SSEMcpConfig.omit({ updatedAt: true, createdAt: true }),
  StdioMcpConfig.omit({ updatedAt: true, createdAt: true }),
])
export type AddMcpConfigSchema = z.infer<typeof AddMcpConfigSchema>

export const McpConfigSchema = z.discriminatedUnion('transportType', [SSEMcpConfig, StdioMcpConfig])
export type McpConfigSchema = z.infer<typeof McpConfigSchema>

export const UpdateMcpConfigSchema = z.discriminatedUnion('transportType', [
  SSEMcpConfig.partial().extend({ serverName: z.string(), transportType: z.literal('sse') }),
  StdioMcpConfig.partial().extend({ serverName: z.string(), transportType: z.literal('stdio') }),
])

export type UpdateMcpConfigSchema = z.infer<typeof UpdateMcpConfigSchema>
