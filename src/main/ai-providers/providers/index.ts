import type { AIProviderConstructor } from './interface'
import { DeepSeekService } from './deepseek'
import GeminiService from './gemini'
import OpenAIService from './openai'

export const AIProviderMapping: Record<string, AIProviderConstructor> = {
  openai: OpenAIService,
  gemini: GeminiService,
  deepseek: DeepSeekService,
} as const
