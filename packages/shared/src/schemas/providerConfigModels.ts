import { z } from 'zod'
import { ProviderConfigSchema } from './providerConfig'

export const ModelCostSchema = z.object({
  input: z.number(),
  output: z.number(),
  cacheRead: z.number().optional(),
  cacheWrite: z.number().optional(),
}).optional()

export type ModelCostSchema = z.infer<typeof ModelCostSchema>

const InputModalitiesSchema = z.array(z.enum(['text', 'image', 'pdf', 'video', 'audio']))
const OutputModalitiesSchema = z.array(z.enum(['text', 'image']))

export const ModelCapabilitiesSchema = z.object({
  functionCall: z.boolean().optional(),
  reasoning: z.boolean().optional(),
  supportsTemperature: z.boolean().optional(),
  structuredOutput: z.boolean().optional(),
  inputModalities: InputModalitiesSchema.optional(),
  outputModalities: OutputModalitiesSchema.optional(),
})

export const ProviderConfigModelSchema = z.object({
  id: z.string(),
  model: z.string(),
  name: z.string(),
  isBuiltin: z.union([z.boolean(), z.number()]).transform(val => Boolean(val)),
  isEnabled: z.union([z.boolean(), z.number()]).transform(val => Boolean(val)),
  maxTokens: z.number(),
  contextLength: z.number(),
  temperature: z.number().min(0).max(2),
  capabilities: ModelCapabilitiesSchema.optional().nullable(),
  cost: ModelCostSchema,
  providerId: z.string(),
  createdAt: z.number(),
})

export const AllAvailableModels = ProviderConfigSchema.omit({ isEnabled: true, createdAt: true, updatedAt: true }).extend({
  models: z.array(ProviderConfigModelSchema.pick({ id: true, name: true, model: true, capabilities: true, providerId: true, maxTokens: true, contextLength: true, temperature: true, cost: true })),
})

export const CreateProviderConfigModelSchema = ProviderConfigModelSchema.omit({
  id: true,
  isBuiltin: true,
  isEnabled: true,
  createdAt: true,
})

// ============================ Schema 转换类型 ============================
export type CreateProviderConfigModelSchema = z.infer<typeof CreateProviderConfigModelSchema>

export type ModelCapabilitiesSchema = z.infer<typeof ModelCapabilitiesSchema>

export type AllAvailableModelsSchema = z.infer<typeof AllAvailableModels>

export type ProviderConfigModelSchema = z.infer<typeof ProviderConfigModelSchema>
