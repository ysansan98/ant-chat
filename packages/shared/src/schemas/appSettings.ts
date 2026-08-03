import { z } from 'zod'
import { ProviderConfigSchema } from './providerConfig'
import { ModelCapabilitiesSchema, ModelCostSchema, ReasoningEffortSchema } from './providerConfigModels'

export const AppearanceSettingsSchema = z.object({
  mode: z.enum(['system', 'light', 'dark']),
  lightThemeId: z.string().min(1),
  darkThemeId: z.string().min(1),
})

export type AppearanceSettingsState = z.infer<typeof AppearanceSettingsSchema>

export const DeveloperToolsSettingsSchema = z.object({
  agentObservabilityEnabled: z.boolean().default(false),
}).default({
  agentObservabilityEnabled: false,
})

export type DeveloperToolsSettingsState = z.infer<typeof DeveloperToolsSettingsSchema>

export const ProviderModelSettingsSchema = z.object({
  isEnabled: z.boolean(),
  temperature: z.number().min(0).max(2).optional(),
  name: z.string().optional(),
  maxOutputTokens: z.number().optional(),
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

export const AppSettingsSchema = z.object({
  assistantModelId: z.string(),
  assistantProviderId: z.string().default(''),
  /** 用户最近一次在普通对话中显式选择的模型，用作新会话起始值。 */
  defaultModelId: z.string().default(''),
  defaultProviderId: z.string().default(''),
  autoGenerateTitle: z.boolean().default(false),
  /** 全局默认推理强度档位，创建新会话时使用。未设置时走厂商默认。 */
  reasoningEffort: ReasoningEffortSchema.optional(),
  proxySettings: z.object({
    mode: z.enum(['none', 'system', 'custom']),
    customProxyUrl: z.string().optional(),
  }),
  appearance: AppearanceSettingsSchema.default({
    mode: 'system',
    lightThemeId: 'default',
    darkThemeId: 'default',
  }),
  developerTools: DeveloperToolsSettingsSchema,
  providers: z.array(ProviderSettingsSchema),
})

export type ProviderModelSettingsSchema = z.infer<typeof ProviderModelSettingsSchema>
export type ProviderSettingsSchema = z.infer<typeof ProviderSettingsSchema>
export type AppSettingsState = z.infer<typeof AppSettingsSchema>
