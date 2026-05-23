import type { ProxySettings } from './proxy'
import { z } from 'zod'

export const GeneralSettingsSchema = z.object({
  assistantModelId: z.string(),
  proxySettings: z.object({
    mode: z.enum(['none', 'system', 'custom']),
    customProxyUrl: z.string().optional(),
  }),
})

export type GeneralSettingsState = z.infer<typeof GeneralSettingsSchema> & {
  proxySettings: ProxySettings
}
