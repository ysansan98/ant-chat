import type { ImportSkillOptions, SetSkillEnabledOptions, SkillIndex, SkillManifest } from '@ant-chat/shared'
import { getAppRpcClient } from './transports/appRpc'

export const skillApi = {
  listSkills: async (): Promise<SkillIndex> => {
    return getAppRpcClient().call('skills.listSkills', undefined)
  },

  importSkill: async (options: ImportSkillOptions): Promise<SkillManifest> => {
    return getAppRpcClient().call('skills.importSkill', { options })
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
