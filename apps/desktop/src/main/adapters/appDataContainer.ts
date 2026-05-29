import path from 'node:path'
import { createAppDataServices } from '@ant-chat/app-data'
import { getDb } from '@main/db/db'
import { getAppDataRoot } from '@main/utils/appPaths'

type AppDataServices = ReturnType<typeof createAppDataServices>

let appDataServices: AppDataServices | null = null

export function getAppDataServices(): AppDataServices {
  if (!appDataServices) {
    appDataServices = createAppDataServices({
      db: getDb(),
      settingsFilePath: path.join(getAppDataRoot(), 'settings.json'),
      mcpSettingsFilePath: path.join(getAppDataRoot(), 'mcp.json'),
      profileRootPath: path.join(getAppDataRoot(), 'agent-profile'),
      workspaceSettingsFilePath: path.join(getAppDataRoot(), 'workspace.json'),
    })
  }

  return appDataServices
}
