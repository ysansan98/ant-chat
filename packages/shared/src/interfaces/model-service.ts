import type { ChatFeatures } from './db-types'

export interface ModelSettings {
  systemPrompt: string
  temperature: number
  maxTokens: number
  model: string
  features: ChatFeatures
}
