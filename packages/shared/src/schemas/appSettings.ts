import { z } from 'zod'
import { ProviderConfigSchema } from './providerConfig'
import { ModelCapabilitiesSchema, ModelCostSchema } from './providerConfigModels'

export const ProviderModelSettingsSchema = z.object({
  isEnabled: z.boolean(),
  temperature: z.number().min(0).max(2).optional(),
  name: z.string().optional(),
  maxTokens: z.number().optional(),
  contextLength: z.number().optional(),
  capabilities: ModelCapabilitiesSchema.optional().nullable(),
  cost: ModelCostSchema,
})

export const ProviderSettingsSchema = ProviderConfigSchema.omit({
  createdAt: true,
  updatedAt: true,
  hasApiKey: true,
}).extend({
  apiKey: z.string().optional(),
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
  assistantProviderId: z.string().default(''),
  proxySettings: z.object({
    mode: z.enum(['none', 'system', 'custom']),
    customProxyUrl: z.string().optional(),
  }),
  providers: z.array(ProviderSettingsSchema),
  toolApprovalWhitelist: z.array(ToolApprovalWhitelistEntrySchema).default([]),
})

export type ProviderModelSettingsSchema = z.infer<typeof ProviderModelSettingsSchema>
export type ProviderSettingsSchema = z.infer<typeof ProviderSettingsSchema>
export type AppSettingsState = z.infer<typeof AppSettingsSchema>
