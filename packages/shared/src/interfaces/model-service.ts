import type { ChatFeatures } from './db-types'

export interface ChatSettings {
  systemPrompt: string
  temperature: number
  maxTokens: number
  model: string
  features: ChatFeatures
}
