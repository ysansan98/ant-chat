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

// 会话设置
export const ConversationsSettingsSchema = z.object({
  modelId: z.string(),
  systemPrompt: z.string(),
  temperature: z.number(),
  maxTokens: z.number(),
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
