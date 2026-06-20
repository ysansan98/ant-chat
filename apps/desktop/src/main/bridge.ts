import type { IpcServiceConstructor, MergeIpcService } from 'electron-ipc-decorator'
import { createServices } from 'electron-ipc-decorator'
import { AppIpcService } from './domains/app/ipc'
import { RuntimeIpcService } from './domains/runtime/ipc'
import { SettingsIpcService } from './domains/settings/ipc'
import { SkillsIpcService } from './domains/skills/ipc'
import { UpdateIpcService } from './domains/update/ipc'

export const ipcServiceClasses = [
  AppIpcService,
  RuntimeIpcService,
  SettingsIpcService,
  SkillsIpcService,
  UpdateIpcService,
] as const satisfies readonly IpcServiceConstructor[]

export const services = createServices(ipcServiceClasses)

export type IpcServices = MergeIpcService<typeof services>
