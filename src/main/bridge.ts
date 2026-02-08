import type { IpcServiceConstructor, MergeIpcService } from 'electron-ipc-decorator'
import { createServices } from 'electron-ipc-decorator'
import { AppIpcService } from './domains/app/ipc'
import { ChatIpcService } from './domains/chat/ipc'
import { McpIpcService } from './domains/mcp/ipc'
import { ProviderIpcService } from './domains/provider/ipc'
import { SearchIpcService } from './domains/search/ipc'
import { SettingsIpcService } from './domains/settings/ipc'
import { UpdateIpcService } from './domains/update/ipc'

export const ipcServiceClasses = [
  AppIpcService,
  ChatIpcService,
  McpIpcService,
  ProviderIpcService,
  SearchIpcService,
  SettingsIpcService,
  UpdateIpcService,
] as const satisfies readonly IpcServiceConstructor[]

export const services = createServices(ipcServiceClasses)

export type IpcServices = MergeIpcService<typeof services>
