import type { ImportSkillFromGithubOptions, SetSkillEnabledOptions, SkillIndex, SkillManifest } from '@ant-chat/shared'
import { getAppTransport } from './transports/appTransport'

export const skillApi = {
  listSkills: async (): Promise<SkillIndex> => {
    return (await getAppTransport()).skills.listSkills()
  },

  importSkillFromZip: async (): Promise<SkillManifest | null> => {
    return (await getAppTransport()).skills.importSkillFromZip()
  },

  importSkillFromGithub: async (options: ImportSkillFromGithubOptions): Promise<SkillManifest> => {
    return (await getAppTransport()).skills.importSkillFromGithub(options)
  },

  setSkillEnabled: async (options: SetSkillEnabledOptions): Promise<SkillManifest> => {
    return (await getAppTransport()).skills.setSkillEnabled(options)
  },

  deleteSkill: async (name: string): Promise<null> => {
    return (await getAppTransport()).skills.deleteSkill(name)
  },

  rebuildSkillIndex: async (): Promise<SkillIndex> => {
    return (await getAppTransport()).skills.rebuildSkillIndex()
  },
}
