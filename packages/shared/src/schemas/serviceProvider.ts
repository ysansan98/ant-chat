import { z } from 'zod'

export const ServiceProviderSchema = z.object({
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

export const AddServiceProviderSchema = ServiceProviderSchema
  .omit({ updatedAt: true, createdAt: true })
  .partial({ isEnabled: true, id: true, isOfficial: true })
  .required({ apiKey: true })

export type AddServiceProviderSchema = z.infer<typeof AddServiceProviderSchema>

export const UpdateServiceProviderSchema = ServiceProviderSchema
  .omit({ updatedAt: true, createdAt: true })
  .partial()
  .required({ id: true })

export type UpdateServiceProviderSchema = z.infer<typeof UpdateServiceProviderSchema>
export type ServiceProviderSchema = z.infer<typeof ServiceProviderSchema>
