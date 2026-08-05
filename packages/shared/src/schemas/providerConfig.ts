import { z } from 'zod'

export const ProviderCapabilitiesSchema = z.object({
  authentication: z.enum(['api-key', 'oauth']),
  modelSource: z.enum(['models-dev', 'provider']),
  localAuthImport: z.boolean(),
  usage: z.enum(['none', 'quota']),
  endpoint: z.enum(['custom', 'fixed']),
  fixedBaseUrl: z.url().optional(),
})

export const ProviderIntegrationIdSchema = z.string().min(1)

export const CODEX_SUBSCRIPTION_BASE_URL = 'https://chatgpt.com/backend-api/codex'

export const ProviderConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  baseUrl: z.url(),
  apiKey: z.string().optional(),
  apiKeySecretId: z.string().optional(),
  hasApiKey: z.boolean().optional(),
  /** 推理 wire protocol；产品订阅身份由 integrationId 表达。 */
  apiMode: z.enum(['openai', 'anthropic', 'google', 'deepseek']),
  integrationId: ProviderIntegrationIdSchema,
  /** 运行时由 Integration 派生的能力描述，用户不可写、settings 不持久化。 */
  capabilities: ProviderCapabilitiesSchema.optional(),
  isOfficial: z.boolean(),
  isEnabled: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
})

/** 用户可写配置：不包含运行时派生的 capabilities。 */
const providerUserConfig = ProviderConfigSchema
  .omit({ updatedAt: true, createdAt: true, hasApiKey: true, capabilities: true, apiKeySecretId: true })
  .extend({ apiKey: z.string().optional() })

export const CreateProviderConfigSchema = providerUserConfig
  .partial({ isEnabled: true, id: true, isOfficial: true })

export type CreateProviderConfigSchema = z.infer<typeof CreateProviderConfigSchema>

export const UpdateProviderConfigSchema = providerUserConfig
  .partial()
  .required({ id: true })

export type UpdateProviderConfigSchema = z.infer<typeof UpdateProviderConfigSchema>
export type ProviderConfigSchema = z.infer<typeof ProviderConfigSchema>
export const ProviderPublicViewSchema = ProviderConfigSchema.omit({ apiKey: true, apiKeySecretId: true })
export type ProviderPublicView = z.infer<typeof ProviderPublicViewSchema>
export type ProviderFormat = z.infer<typeof ProviderConfigSchema>['apiMode']
export type ProviderCapabilities = z.infer<typeof ProviderCapabilitiesSchema>
export type ProviderIntegrationId = z.infer<typeof ProviderIntegrationIdSchema>

export const ProviderIntegrationCatalogItemSchema = z.object({
  id: ProviderIntegrationIdSchema,
  label: z.string().min(1),
  authentication: ProviderCapabilitiesSchema.shape.authentication,
  defaultApiMode: ProviderConfigSchema.shape.apiMode,
  fixedApiMode: ProviderConfigSchema.shape.apiMode.optional(),
  fixedBaseUrl: z.url().optional(),
})
export type ProviderIntegrationCatalogItem = z.infer<typeof ProviderIntegrationCatalogItemSchema>
