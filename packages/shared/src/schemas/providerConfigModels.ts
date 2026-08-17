import { z } from 'zod'
import { ProviderConfigSchema } from './providerConfig'

/**
 * 推理强度档位，对齐 ai-sdk v7 统一的 `reasoning` 参数。
 * `provider-default` 表示交由厂商默认，不显式覆盖。
 */
export const ReasoningEffortSchema = z.enum([
  'provider-default',
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
])

export type ReasoningEffortLevel = z.infer<typeof ReasoningEffortSchema>

// models.dev 的 effort 档位到 ai-sdk v7 档位的映射（max → xhigh）
const MODELS_DEV_EFFORT_TO_V7: Record<string, ReasoningEffortLevel> = {
  none: 'none',
  minimal: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
  max: 'xhigh',
}

/**
 * 将 models.dev 返回的 effort 档位值映射为 ai-sdk v7 档位。
 * 未知档位被丢弃；无有效档位时返回 undefined。
 */
export function mapModelsDevEffortToV7(values: string[] | undefined): ReasoningEffortLevel[] | undefined {
  if (!values || values.length === 0) {
    return undefined
  }
  const mapped = values
    .map(value => MODELS_DEV_EFFORT_TO_V7[value])
    .filter((level): level is ReasoningEffortLevel => Boolean(level))
  return mapped.length > 0 ? mapped : undefined
}

export const ModelCostSchema = z.object({
  input: z.number(),
  output: z.number(),
  cacheRead: z.number().optional(),
  cacheWrite: z.number().optional(),
}).optional()

export type ModelCostSchema = z.infer<typeof ModelCostSchema>

const InputModalitiesSchema = z.array(z.enum(['text', 'image', 'pdf', 'video', 'audio']))
// 与 models.dev 的 output 枚举对齐（含 video/audio/pdf 输出模型）；当前无运行时消费方。
const OutputModalitiesSchema = z.array(z.enum(['text', 'image', 'video', 'audio', 'pdf']))

export const ModelCapabilitiesSchema = z.object({
  functionCall: z.boolean().optional(),
  reasoning: z.boolean().optional(),
  /** 模型支持的推理强度档位（来自 models.dev 的 effort 选项，已映射为 ai-sdk v7 档位）。存在该字段即表示可配置推理强度。 */
  reasoningLevels: z.array(ReasoningEffortSchema).optional(),
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
  maxOutputTokens: z.number(),
  contextLength: z.number(),
  temperature: z.number().min(0).max(2),
  capabilities: ModelCapabilitiesSchema.optional().nullable(),
  cost: ModelCostSchema,
  providerId: z.string(),
  createdAt: z.number(),
})

export const AllAvailableModels = ProviderConfigSchema.omit({ isEnabled: true, createdAt: true, updatedAt: true }).extend({
  models: z.array(ProviderConfigModelSchema.pick({ id: true, name: true, model: true, capabilities: true, providerId: true, maxOutputTokens: true, contextLength: true, temperature: true, cost: true })),
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
