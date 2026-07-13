import type { z } from 'zod'
import type { AppearanceSettingsState } from '../schemas/appSettings'
import type { ProxySettings } from './proxy'
import { AppSettingsSchema } from '../schemas/appSettings'

export const GeneralSettingsSchema = AppSettingsSchema.pick({
  assistantModelId: true,
  assistantProviderId: true,
  autoGenerateTitle: true,
  reasoningEffort: true,
  proxySettings: true,
  appearance: true,
})

export type GeneralSettingsState = z.infer<typeof GeneralSettingsSchema> & {
  proxySettings: ProxySettings
  appearance: AppearanceSettingsState
}
