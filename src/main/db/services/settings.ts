import type { GeneralSettingsState } from '@ant-chat/shared'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { appSettingsTable } from '../schema'

const GENERAL_SETTINGS_KEY = 'general'

export const DEFAULT_GENERAL_SETTINGS: GeneralSettingsState = {
  assistantModelId: '',
  proxySettings: {
    mode: 'none',
    customProxyUrl: '',
  },
}

export async function getGeneralSettings(): Promise<GeneralSettingsState> {
  const result = db.select().from(appSettingsTable).where(eq(appSettingsTable.key, GENERAL_SETTINGS_KEY)).get()
  return result?.value ?? DEFAULT_GENERAL_SETTINGS
}

export async function updateGeneralSettings(updates: Partial<GeneralSettingsState>): Promise<GeneralSettingsState> {
  const currentSettings = await getGeneralSettings()
  const nextSettings: GeneralSettingsState = {
    ...currentSettings,
    ...updates,
    proxySettings: updates.proxySettings
      ? { ...currentSettings.proxySettings, ...updates.proxySettings }
      : currentSettings.proxySettings,
  }

  db.insert(appSettingsTable)
    .values({ key: GENERAL_SETTINGS_KEY, value: nextSettings, updatedAt: Date.now() })
    .onConflictDoUpdate({
      target: appSettingsTable.key,
      set: { value: nextSettings, updatedAt: Date.now() },
    })
    .run()

  return nextSettings
}

export async function resetGeneralSettings(): Promise<GeneralSettingsState> {
  db.insert(appSettingsTable)
    .values({ key: GENERAL_SETTINGS_KEY, value: DEFAULT_GENERAL_SETTINGS, updatedAt: Date.now() })
    .onConflictDoUpdate({
      target: appSettingsTable.key,
      set: { value: DEFAULT_GENERAL_SETTINGS, updatedAt: Date.now() },
    })
    .run()

  return DEFAULT_GENERAL_SETTINGS
}
