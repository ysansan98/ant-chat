import type { IpcServiceConstructor, MergeIpcService } from 'electron-ipc-decorator'
import { createServices } from 'electron-ipc-decorator'
import { AgentIpcService } from './domains/agent/ipc'
import { AppIpcService } from './domains/app/ipc'
import { ChatIpcService } from './domains/chat/ipc'
import { McpIpcService } from './domains/mcp/ipc'
import { ProviderIpcService } from './domains/provider/ipc'
import { SearchIpcService } from './domains/search/ipc'
import { SettingsIpcService } from './domains/settings/ipc'
import { UpdateIpcService } from './domains/update/ipc'
import { WorkspaceIpcService } from './domains/workspace/ipc'

export const ipcServiceClasses = [
  AgentIpcService,
  AppIpcService,
  ChatIpcService,
  McpIpcService,
  ProviderIpcService,
  SearchIpcService,
  SettingsIpcService,
  UpdateIpcService,
  WorkspaceIpcService,
] as const satisfies readonly IpcServiceConstructor[]

export const services = createServices(ipcServiceClasses)

export type IpcServices = MergeIpcService<typeof services>
