import type { ReasoningEffortLevel } from '../schemas/providerConfigModels'

export interface ModelSettings {
  temperature: number
  maxOutputTokens: number
  model: string
  /** 推理强度档位（ai-sdk v7 统一参数）。未设置时走厂商默认。 */
  reasoningEffort?: ReasoningEffortLevel
}
