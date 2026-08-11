import type { z } from 'zod'
import type { AppearanceSettingsState, DeveloperToolsSettingsState } from '../schemas/appSettings'
import type { ProxySettings } from './proxy'
import { AppSettingsSchema } from '../schemas/appSettings'

export const GeneralSettingsSchema = AppSettingsSchema.pick({
  assistantModelId: true,
  assistantProviderId: true,
  visionModelId: true,
  visionProviderId: true,
  defaultModelId: true,
  defaultProviderId: true,
  autoGenerateTitle: true,
  reasoningEffort: true,
  proxySettings: true,
  appearance: true,
  developerTools: true,
})

export type GeneralSettingsState = z.infer<typeof GeneralSettingsSchema> & {
  proxySettings: ProxySettings
  appearance: AppearanceSettingsState
  developerTools: DeveloperToolsSettingsState
}
