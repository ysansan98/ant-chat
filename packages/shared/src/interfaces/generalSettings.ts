import type { z } from 'zod'
import type { ProxySettings } from './proxy'
import { AppSettingsSchema } from '../schemas/appSettings'

export const GeneralSettingsSchema = AppSettingsSchema.pick({
  assistantModelId: true,
  assistantProviderId: true,
  proxySettings: true,
})

export type GeneralSettingsState = z.infer<typeof GeneralSettingsSchema> & {
  proxySettings: ProxySettings
}
