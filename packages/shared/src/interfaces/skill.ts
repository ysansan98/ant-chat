export type SkillSource = 'zip' | 'github' | 'builtin'

export interface SkillManifest {
  name: string
  version?: string
  description?: string
  source: SkillSource
  sourceUrl?: string
  enabled: boolean
  builtin?: boolean
  installedAt: number
  updatedAt: number
}

export interface SkillIndex {
  rootPath: string
  skills: SkillManifest[]
}

export interface ImportSkillFromGithubOptions {
  url: string
  name?: string
}

export interface SetSkillEnabledOptions {
  name: string
  enabled: boolean
}

export interface DeleteSkillOptions {
  name: string
}
