import { z } from 'zod'
import { ServiceProviderSchema } from './serviceProvider'

export const ModelFeaturesSchema = z.object({
  functionCall: z.boolean().optional(),
  reasoning: z.boolean().optional(),
  vision: z.boolean().optional(),
})

export const ServiceProviderModelsSchema = z.object({
  id: z.string(),
  model: z.string(),
  name: z.string(),
  isBuiltin: z.union([z.boolean(), z.number()]).transform(val => Boolean(val)),
  isEnabled: z.union([z.boolean(), z.number()]).transform(val => Boolean(val)),
  maxTokens: z.number(),
  contextLength: z.number(),
  temperature: z.number().min(0).max(2),
  modelFeatures: ModelFeaturesSchema.optional().nullable(),
  serviceProviderId: z.string(),
  createdAt: z.number(),
})

export const AllAvailableModels = ServiceProviderSchema.omit({ isEnabled: true, createdAt: true, updatedAt: true }).extend({
  models: z.array(ServiceProviderModelsSchema.pick({ id: true, name: true, model: true, modelFeatures: true, serviceProviderId: true, maxTokens: true, contextLength: true, temperature: true })),
})

export const AddServiceProviderModelSchema = ServiceProviderModelsSchema.omit({
  id: true,
  isBuiltin: true,
  isEnabled: true,
  createdAt: true,
})

// ============================ Schema 转换类型 ============================
export type AddServiceProviderModelSchema = z.infer<typeof AddServiceProviderModelSchema>

export type ModelFeaturesSchema = z.infer<typeof ModelFeaturesSchema>

export type AllAvailableModelsSchema = z.infer<typeof AllAvailableModels>

export type ServiceProviderModelsSchema = z.infer<typeof ServiceProviderModelsSchema>
