import type { IpcServiceConstructor, MergeIpcService } from 'electron-ipc-decorator'
import { createServices } from 'electron-ipc-decorator'
import { AppIpcService } from './domains/app/ipc'
import { BrowserProfilesIpcService } from './domains/browserProfiles/ipc'
import { RuntimeIpcService } from './domains/runtime/ipc'
import { UpdateIpcService } from './domains/update/ipc'

export const ipcServiceClasses = [
  AppIpcService,
  BrowserProfilesIpcService,
  RuntimeIpcService,
  UpdateIpcService,
] as const satisfies readonly IpcServiceConstructor[]

export const services = createServices(ipcServiceClasses)

export type IpcServices = MergeIpcService<typeof services>
