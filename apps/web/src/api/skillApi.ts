import type { ImportSkillFromGithubOptions, SetSkillEnabledOptions, SkillIndex, SkillManifest } from '@ant-chat/shared'
import { ipc, isElectronRuntime, unwrapIpcResponse } from '@/utils/ipc-bus'
import { localRpc } from './transports/localWebTransport'

export const skillApi = {
  listSkills: async (): Promise<SkillIndex> => {
    if (!isElectronRuntime())
      return localRpc('skills.listSkills')
    return unwrapIpcResponse(await ipc.skills.listSkills())
  },

  importSkillFromZip: async (): Promise<SkillManifest | null> => {
    if (!isElectronRuntime())
      return localRpc('skills.importSkillFromZip')
    return unwrapIpcResponse(await ipc.skills.importSkillFromZip())
  },

  importSkillFromGithub: async (options: ImportSkillFromGithubOptions): Promise<SkillManifest> => {
    if (!isElectronRuntime())
      return localRpc('skills.importSkillFromGithub', { options })
    return unwrapIpcResponse(await ipc.skills.importSkillFromGithub(options))
  },

  setSkillEnabled: async (options: SetSkillEnabledOptions): Promise<SkillManifest> => {
    if (!isElectronRuntime())
      return localRpc('skills.setSkillEnabled', { options })
    return unwrapIpcResponse(await ipc.skills.setSkillEnabled(options))
  },

  deleteSkill: async (name: string): Promise<null> => {
    if (!isElectronRuntime())
      return localRpc('skills.deleteSkill', { name })
    return unwrapIpcResponse(await ipc.skills.deleteSkill(name))
  },

  rebuildSkillIndex: async (): Promise<SkillIndex> => {
    if (!isElectronRuntime())
      return localRpc('skills.rebuildSkillIndex')
    return unwrapIpcResponse(await ipc.skills.rebuildSkillIndex())
  },
}
