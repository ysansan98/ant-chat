import type { ImportSkillFromGithubOptions, SetSkillEnabledOptions, SkillIndex, SkillManifest } from '@ant-chat/shared'
import { ipc, isElectronRuntime, unwrapIpcResponse } from '@/utils/ipc-bus'
import { getAppRpcClient } from './transports/appRpc'

export const skillApi = {
  listSkills: async (): Promise<SkillIndex> => {
    return getAppRpcClient().call('skills.listSkills', undefined)
  },

  importSkillFromZip: async (): Promise<SkillManifest | null> => {
    if (!isElectronRuntime()) {
      return null
    }
    return unwrapIpcResponse(await ipc.skills.importSkillFromZip())
  },

  importSkillFromGithub: async (options: ImportSkillFromGithubOptions): Promise<SkillManifest> => {
    return getAppRpcClient().call('skills.importSkillFromGithub', { options })
  },

  setSkillEnabled: async (options: SetSkillEnabledOptions): Promise<SkillManifest> => {
    return getAppRpcClient().call('skills.setSkillEnabled', { options })
  },

  deleteSkill: async (name: string): Promise<null> => {
    return getAppRpcClient().call('skills.deleteSkill', { name })
  },

  rebuildSkillIndex: async (): Promise<SkillIndex> => {
    return getAppRpcClient().call('skills.rebuildSkillIndex', undefined)
  },
}
