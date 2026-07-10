import type { ReasoningEffortLevel } from '../schemas/providerConfigModels'
import type { ChatFeatures } from './db-types'

export interface ModelSettings {
  systemPrompt: string
  temperature: number
  maxTokens: number
  model: string
  features: ChatFeatures
  /** 推理强度档位（ai-sdk v7 统一参数）。未设置时走厂商默认。 */
  reasoningEffort?: ReasoningEffortLevel
}
