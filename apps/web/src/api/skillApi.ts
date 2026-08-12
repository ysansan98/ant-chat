import type { GithubSkillPreview, ImportGithubSkillsResult, ImportSkillOptions, SetSkillEnabledOptions, SkillIndex, SkillManifest } from '@ant-chat/shared'
import { getAppRpcClient } from './transports/appRpc'

export const skillApi = {
  listSkills: async (): Promise<SkillIndex> => {
    return getAppRpcClient().call('skills.listSkills', undefined)
  },

  importSkill: async (options: ImportSkillOptions): Promise<SkillManifest> => {
    return getAppRpcClient().call('skills.importSkill', { options })
  },

  previewGithubSkills: async (url: string): Promise<GithubSkillPreview[]> => {
    return getAppRpcClient().call('skills.previewGithubSkills', { options: { url } })
  },

  importGithubSkills: async (url: string, paths: string[]): Promise<ImportGithubSkillsResult> => {
    return getAppRpcClient().call('skills.importGithubSkills', { options: { url, paths } })
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
