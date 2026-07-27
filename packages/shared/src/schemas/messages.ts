import { z } from 'zod'

import { CommandMetadataSchema } from './command'
import { VisualizationBlockSchema, VisualizationOutputBlocksSchema } from './visualization'

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
  args: z.record(z.string(), z.unknown()),
  serverName: z.string().optional(),
  /** 命令工具的结构化解释器身份，供展示和 Trace 使用。 */
  command: CommandMetadataSchema.optional(),
  executeState: z.enum(['executing', 'completed']).optional(),
  /** 仅限 agent loop 内部 transport，持久化前由 session emitter 剥离。 */
  outputBlocks: VisualizationOutputBlocksSchema.shape.outputBlocks.optional(),
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

// ============================ 新增：文件引用类型 ============================

// 文件 ID 来源（本地存储）
export const FileIdSourceSchema = z.object({
  type: z.literal('file_id'),
  file_id: z.string(),
})

export type FileIdSource = z.infer<typeof FileIdSourceSchema>

// URL 来源（远程图片）
export const UrlSourceSchema = z.object({
  type: z.literal('url'),
  url: z.string(),
})

export type UrlSource = z.infer<typeof UrlSourceSchema>

// 内容来源联合类型
export const ContentSourceSchema = z.union([
  FileIdSourceSchema,
  UrlSourceSchema,
])

export type ContentSource = z.infer<typeof ContentSourceSchema>

// 图片内容块（通过 file_id 引用本地文件）
export const ImageBlockSchema = z.object({
  type: z.literal('image-block'),
  source: ContentSourceSchema,
  name: z.string().optional(),
  media_type: z.string().optional(),
  size: z.number().optional(),
  // Transport-only payload. App data strips it before persisting message content.
  data: z.string().optional(),
})

export type ImageBlock = z.infer<typeof ImageBlockSchema>

// 文档内容块（通过 file_id 引用本地文件）
export const DocumentBlockSchema = z.object({
  type: z.literal('document'),
  source: ContentSourceSchema,
  title: z.string().optional(),
  context: z.string().optional(),
  name: z.string().optional(),
  media_type: z.string().optional(),
  size: z.number().optional(),
  // Transport-only payload. App data strips it before persisting message content.
  data: z.string().optional(),
})

export type DocumentBlock = z.infer<typeof DocumentBlockSchema>

// 文件内容块（通用类型，用于非图片非文档的文件）
export const FileBlockSchema = z.object({
  type: z.literal('file'),
  source: ContentSourceSchema,
  filename: z.string().optional(),
  name: z.string().optional(),
  media_type: z.string().optional(),
  size: z.number().optional(),
  // Transport-only payload. App data strips it before persisting message content.
  data: z.string().optional(),
})

export type FileBlock = z.infer<typeof FileBlockSchema>

// ============================ 消息内容 Schema ============================

// 消息内容
export const MessageContentSchema = z.array(z.union([
  TextContentSchema,
  ImageContentSchema,
  ErrorContentSchema,
  ToolCallContentSchema,
  ToolResultContentSchema,
  ImageBlockSchema,
  DocumentBlockSchema,
  FileBlockSchema,
  VisualizationBlockSchema,
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
  args: z.record(z.string(), z.unknown()),
  command: CommandMetadataSchema.optional(),
  executeState: z.enum(['await', 'executing', 'completed']),
  result: McpToolResultSchema.optional(),
  outputBlocks: VisualizationOutputBlocksSchema.shape.outputBlocks.optional(),
})

export type McpToolCall = z.infer<typeof McpToolCallSchema>

const BaseMessage = z.object({
  id: z.nanoid(),
  convId: z.string(),
  content: MessageContentSchema,
  createAt: z.number(),
  turnId: z.string().optional(),
})

export const UserMessage = BaseMessage.extend({
  role: z.literal('user'),
  status: z.literal('success'),
})

export type UserMessage = z.infer<typeof UserMessage>

export const AIMessage = BaseMessage.extend({
  role: z.literal('assistant'),
  status: z.enum(['success', 'error', 'loading', 'typing', 'cancel']),
  modelInfo: ModelInfoSchema,
  reasoningContent: z.string().optional().nullable(),
  usage: LanguageModelUsageSchema.optional().nullable(),
  durationMs: z.number().optional(),
})

export type AIMessage = z.infer<typeof AIMessage>

export const ToolMessage = BaseMessage.extend({
  role: z.literal('tool'),
  status: z.enum(['success', 'error']),
})

export type ToolMessage = z.infer<typeof ToolMessage>

export const EventMessage = BaseMessage.extend({
  role: z.literal('event'),
  status: z.enum(['success', 'loading', 'error']),
  eventType: z.string(),
  modelInfo: ModelInfoSchema.optional(),
  usage: LanguageModelUsageSchema.optional(),
  compactedThroughMessageId: z.string().optional(),
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
  compactedThroughMessageId: z.string().optional(),
  ...(AIMessage.pick({ modelInfo: true, reasoningContent: true, usage: true, durationMs: true }).shape),
}).partial().extend({ id: z.string() })

export type UpdateMessageSchema = z.infer<typeof UpdateMessageSchema>
