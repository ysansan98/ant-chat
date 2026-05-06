import { z } from 'zod'

export const ModelConfigSchema = z.object({
  id: z.string(),
  workspacePath: z.string().nullable().optional(),
  name: z.string().optional(),
  apiHost: z.string(),
  apiKey: z.string(),
  model: z.string(),
  temperature: z.number(),
})

// 上下文压缩设置
export const CompactionSettingsSchema = z.object({
  /** 是否启用上下文压缩 */
  enabled: z.boolean(),
  /** 触发压缩的上下文使用率阈值（百分比 10-90） */
  thresholdPercent: z.number().min(10).max(90),
  /** 保留的最近对话对数（1-10） */
  keepRecentPairs: z.number().min(1).max(10),
})

export type CompactionSettingsSchema = z.infer<typeof CompactionSettingsSchema>

// 会话设置
export const ConversationsSettingsSchema = z.object({
  modelId: z.string(),
  systemPrompt: z.string(),
  temperature: z.number(),
  maxTokens: z.number(),
  compaction: CompactionSettingsSchema.optional(),
  /** 上次压缩的时间戳。早于此时间的消息已被摘要替代 */
  lastCompactedAt: z.number().optional(),
  /** 上次压缩生成的摘要文本，上下文重建时注入，不显示在聊天中 */
  lastCompactionSummary: z.string().optional(),
})

export type ConversationsSettingsSchema = z.infer<typeof ConversationsSettingsSchema>

export const ConversationsSchema = z.object({
  id: z.string(),
  workspacePath: z.string().nullable().optional(),
  title: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  settings: ConversationsSettingsSchema,
})

export type ConversationsSchema = z.infer<typeof ConversationsSchema>

// ============================ Add Conversations Schema ============================
export const AddConversationsSchema = ConversationsSchema.omit({ id: true })
export type AddConversationsSchema = z.infer<typeof AddConversationsSchema>

// ============================ Update Conversations Schema ============================
export const UpdateConversationsSchema = ConversationsSchema.extend({ settings: ConversationsSettingsSchema }).partial().extend({ id: z.string() })

export type UpdateConversationsSchema = z.infer<typeof UpdateConversationsSchema>
