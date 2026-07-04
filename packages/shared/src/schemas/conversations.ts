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

// Context compaction settings
export const CompactionSettingsSchema = z.object({
  /** Whether context compaction is enabled. */
  enabled: z.boolean(),
  /** Context usage threshold percentage that triggers compaction. */
  thresholdPercent: z.number().min(10).max(90),
  /** Target number of recent context tokens kept after compaction. */
  keepRecentTokens: z.number().int().min(1000).max(1_000_000),
})

export type CompactionSettingsSchema = z.infer<typeof CompactionSettingsSchema>

export const DEFAULT_COMPACTION_SETTINGS: Readonly<CompactionSettingsSchema> = Object.freeze({
  enabled: true,
  thresholdPercent: 70,
  keepRecentTokens: 20_000,
})

// Conversation settings
export const ConversationsSettingsSchema = z.object({
  modelId: z.string(),
  providerId: z.string(),
  systemPrompt: z.string(),
  temperature: z.number(),
  maxTokens: z.number(),
  compaction: CompactionSettingsSchema.optional(),
})

export type ConversationsSettingsSchema = z.infer<typeof ConversationsSettingsSchema>

export const ConversationsSchema = z.object({
  id: z.string(),
  workspacePath: z.string().nullable().optional(),
  title: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  archived: z.boolean().default(false).optional(),
  settings: ConversationsSettingsSchema,
})

export type ConversationsSchema = z.infer<typeof ConversationsSchema>

// ============================ Add Conversations Schema ============================
export const AddConversationsSchema = ConversationsSchema.omit({ id: true, archived: true })
export type AddConversationsSchema = z.infer<typeof AddConversationsSchema>

// ============================ Update Conversations Schema ============================
export const UpdateConversationsSchema = ConversationsSchema.omit({ archived: true }).extend({ settings: ConversationsSettingsSchema }).partial().extend({ id: z.string() })

export type UpdateConversationsSchema = z.infer<typeof UpdateConversationsSchema>
