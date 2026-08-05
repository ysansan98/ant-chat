import type { ProviderFormat } from '../schemas/providerConfig'
import type { ReasoningEffortLevel } from '../schemas/providerConfigModels'

export interface ModelsDevProvider {
  id: string
  name: string
  apiMode: ProviderFormat
  baseUrl: string
}

export interface ModelsDevModelCost {
  input: number
  output: number
  cacheRead?: number
  cacheWrite?: number
}

export interface ModelsDevModel {
  id: string
  name: string
  providerId: string
  model: string
  contextLength?: number
  maxOutputTokens?: number
  toolCall?: boolean
  reasoning?: boolean
  /** 模型支持的推理强度档位（已映射为 ai-sdk v7 档位）。存在该字段即表示可配置推理强度。 */
  reasoningLevels?: ReasoningEffortLevel[]
  supportsTemperature?: boolean
  structuredOutput?: boolean
  modalities?: {
    input?: string[]
    output?: string[]
  }
  cost?: ModelsDevModelCost
}
