import type { ImportSkillFromGithubOptions, SetSkillEnabledOptions, SkillIndex, SkillManifest } from '@ant-chat/shared'
import { ipc, unwrapIpcResponse } from '@/utils/ipc-bus'

export const skillApi = {
  listSkills: async (): Promise<SkillIndex> => {
    return unwrapIpcResponse(await ipc.skills.listSkills())
  },

  importSkillFromZip: async (): Promise<SkillManifest | null> => {
    return unwrapIpcResponse(await ipc.skills.importSkillFromZip())
  },

  importSkillFromGithub: async (options: ImportSkillFromGithubOptions): Promise<SkillManifest> => {
    return unwrapIpcResponse(await ipc.skills.importSkillFromGithub(options))
  },

  setSkillEnabled: async (options: SetSkillEnabledOptions): Promise<SkillManifest> => {
    return unwrapIpcResponse(await ipc.skills.setSkillEnabled(options))
  },

  deleteSkill: async (name: string): Promise<null> => {
    return unwrapIpcResponse(await ipc.skills.deleteSkill(name))
  },

  rebuildSkillIndex: async (): Promise<SkillIndex> => {
    return unwrapIpcResponse(await ipc.skills.rebuildSkillIndex())
  },
}
