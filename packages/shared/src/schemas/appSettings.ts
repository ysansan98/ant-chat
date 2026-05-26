import { z } from 'zod'
import { ServiceProviderSchema } from './serviceProvider'
import { ModelFeaturesSchema } from './serviceProviderModels'

export const ProviderModelOverridesSchema = z.object({
  name: z.string().optional(),
  maxTokens: z.number().optional(),
  contextLength: z.number().optional(),
  modelFeatures: ModelFeaturesSchema.optional().nullable(),
}).optional()

export const ProviderModelSettingsSchema = z.object({
  isEnabled: z.boolean(),
  temperature: z.number().min(0).max(2).optional(),
  overrides: ProviderModelOverridesSchema,
})

export const ProviderSettingsSchema = ServiceProviderSchema.omit({
  createdAt: true,
  updatedAt: true,
}).extend({
  models: z.record(z.string(), ProviderModelSettingsSchema),
})

export const ToolApprovalWhitelistEntrySchema = z.object({
  toolName: z.string(),
  toolScope: z.enum(['workspace', 'outside', 'blocked']),
  pattern: z.string(),
  workspacePath: z.string().optional(),
})

export const AppSettingsSchema = z.object({
  assistantModelId: z.string(),
  proxySettings: z.object({
    mode: z.enum(['none', 'system', 'custom']),
    customProxyUrl: z.string().optional(),
  }),
  logBasePath: z.string().optional(),
  providers: z.array(ProviderSettingsSchema),
  toolApprovalWhitelist: z.array(ToolApprovalWhitelistEntrySchema).default([]),
})

export type ProviderModelOverridesSchema = z.infer<typeof ProviderModelOverridesSchema>
export type ProviderModelSettingsSchema = z.infer<typeof ProviderModelSettingsSchema>
export type ProviderSettingsSchema = z.infer<typeof ProviderSettingsSchema>
export type AppSettingsState = z.infer<typeof AppSettingsSchema>
