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
  /** Recent conversation pairs kept after compaction. */
  keepRecentPairs: z.number().min(1).max(10),
})

export type CompactionSettingsSchema = z.infer<typeof CompactionSettingsSchema>

// Conversation settings
export const ConversationsSettingsSchema = z.object({
  modelId: z.string(),
  systemPrompt: z.string(),
  temperature: z.number(),
  maxTokens: z.number(),
  compaction: CompactionSettingsSchema.optional(),
  /** Last message included in the compaction summary. Earlier messages are replaced by the summary. */
  lastCompactedMessageId: z.string().optional(),
  /** Last compaction summary injected when rebuilding context. It is not shown in chat. */
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
