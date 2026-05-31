import { z } from 'zod'

export const ProviderConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  baseUrl: z.string().url(),
  apiKey: z.string(),
  apiMode: z.enum(['openai', 'anthropic', 'google', 'deepseek']),
  isOfficial: z.boolean(),
  isEnabled: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
})

export const CreateProviderConfigSchema = ProviderConfigSchema
  .omit({ updatedAt: true, createdAt: true })
  .partial({ isEnabled: true, id: true, isOfficial: true })
  .required({ apiKey: true })

export type CreateProviderConfigSchema = z.infer<typeof CreateProviderConfigSchema>

export const UpdateProviderConfigSchema = ProviderConfigSchema
  .omit({ updatedAt: true, createdAt: true })
  .partial()
  .required({ id: true })

export type UpdateProviderConfigSchema = z.infer<typeof UpdateProviderConfigSchema>
export type ProviderConfigSchema = z.infer<typeof ProviderConfigSchema>
export type ProviderFormat = z.infer<typeof ProviderConfigSchema>['apiMode']
