import { z } from 'zod'

// 文本内容
export const TextContentSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
})

export type TextContent = z.infer<typeof TextContentSchema>

// 图片内容
export const ImageContentSchema = z.object({
  type: z.literal('image'),
  mimeType: z.string(),
  data: z.string(),
  url: z.string().optional(),
})

// 错误内容
export const ErrorContentSchema = z.object({
  type: z.literal('error'),
  error: z.string(),
})

export type ErrorContent = z.infer<typeof ErrorContentSchema>

export type ImageContent = z.infer<typeof ImageContentSchema>

// Tool call 内容块（在 assistant 消息的 content 中）
export const ToolCallContentSchema = z.object({
  type: z.literal('tool-call'),
  toolCallId: z.string(),
  toolName: z.string(),
  args: z.record(z.unknown()),
  serverName: z.string().optional(),
})

export type ToolCallContent = z.infer<typeof ToolCallContentSchema>

// Tool result 内容块（在 role: 'tool' 消息的 content 中）
export const ToolResultContentSchema = z.object({
  type: z.literal('tool-result'),
  toolCallId: z.string(),
  toolName: z.string(),
  result: z.unknown(),
  isError: z.boolean().optional(),
})

export type ToolResultContent = z.infer<typeof ToolResultContentSchema>

// 消息内容
export const MessageContentSchema = z.array(z.union([
  TextContentSchema,
  ImageContentSchema,
  ErrorContentSchema,
  ToolCallContentSchema,
  ToolResultContentSchema,
]))

export type MessageContent = z.infer<typeof MessageContentSchema>

// 附件
export const AttachmentSchema = z.object({
  uid: z.string(),
  name: z.string(),
  size: z.number(),
  type: z.string(),
  data: z.string(),
})

export type AttachmentSchema = z.infer<typeof AttachmentSchema>

// 图片
export type ImageSchema = AttachmentSchema

// 模型信息
export const ModelInfoSchema = z.object({
  provider: z.string(),
  providerId: z.string().optional(),
  model: z.string(),
})

export type ModelInfo = z.infer<typeof ModelInfoSchema>

export const LanguageModelUsageSchema = z.object({
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  totalTokens: z.number().optional(),
  reasoningTokens: z.number().optional(),
  cachedInputTokens: z.number().optional(),
})

export type LanguageModelUsage = z.infer<typeof LanguageModelUsageSchema>

// ============================================================
// MCP 工具调用跟踪（agent loop 内部使用，Phase 7 迁移到 content 块后移除）
// ============================================================

export const McpToolResultSchema = z.object({
  success: z.boolean(),
  data: z.string().optional(),
  error: z.string().optional(),
})

export type McpToolResult = z.infer<typeof McpToolResultSchema>

export const McpToolCallSchema = z.object({
  id: z.string(),
  serverName: z.string(),
  toolName: z.string(),
  args: z.record(z.unknown()),
  executeState: z.enum(['await', 'executing', 'completed']),
  result: McpToolResultSchema.optional(),
})

export type McpToolCall = z.infer<typeof McpToolCallSchema>

const BaseMessage = z.object({
  id: z.string().nanoid(),
  convId: z.string(),
  content: MessageContentSchema,
  createAt: z.number(),
  turnId: z.string().optional(),
})

export const UserMessage = BaseMessage.extend({
  role: z.literal('user'),
  images: z.array(AttachmentSchema),
  attachments: z.array(AttachmentSchema),
  status: z.literal('success'),
})

export type UserMessage = z.infer<typeof UserMessage>

export const AIMessage = BaseMessage.extend({
  role: z.literal('assistant'),
  status: z.enum(['success', 'error', 'loading', 'typing', 'cancel']),
  modelInfo: ModelInfoSchema,
  reasoningContent: z.string().optional().nullable(),
  usage: LanguageModelUsageSchema.optional().nullable(),
})

export type AIMessage = z.infer<typeof AIMessage>

export const ToolMessage = BaseMessage.extend({
  role: z.literal('tool'),
  status: z.enum(['success', 'error']),
})

export type ToolMessage = z.infer<typeof ToolMessage>

export const EventMessage = BaseMessage.extend({
  role: z.literal('event'),
  status: z.literal('success'),
  eventType: z.string(),
})

export type EventMessage = z.infer<typeof EventMessage>

export const Message = z.discriminatedUnion('role', [AIMessage, UserMessage, ToolMessage, EventMessage])
export type Message = z.infer<typeof Message>

// ============================ Add Message Schema ============================
export const AddMessage = z.discriminatedUnion('role', [
  AIMessage.omit({ id: true, createAt: true }),
  UserMessage.omit({ id: true, createAt: true }),
  ToolMessage.omit({ id: true, createAt: true }),
  EventMessage.omit({ id: true, createAt: true }),
])
export type AddMessage = z.infer<typeof AddMessage>

// ============================ Update Message Schema ============================
export const UpdateMessageSchema = BaseMessage.extend({
  status: AIMessage.shape.status,
  role: z.enum(['assistant', 'user', 'tool', 'event']),
  eventType: z.string().optional(),
  ...(AIMessage.pick({ modelInfo: true, reasoningContent: true, usage: true }).shape),
  ...(UserMessage.pick({ images: true, attachments: true }).shape),
}).partial().extend({ id: z.string() })

export type UpdateMessageSchema = z.infer<typeof UpdateMessageSchema>
