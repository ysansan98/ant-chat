/** Agent Skills 标准 frontmatter 字段（来源：SKILL.md YAML frontmatter） */
export interface SkillFrontmatter {
  name: string
  description: string
  version?: string
  license?: string
  compatibility?: string
  metadata?: Record<string, string>
  allowedTools?: string
}

export type SkillSource = 'zip' | 'github' | 'builtin'

/** 应用层可变状态（仅持久化在 .index.json 中） */
export interface SkillAppState {
  enabled: boolean
  builtin: boolean
  source: SkillSource
  sourceUrl?: string
  installedAt: number
  updatedAt: number
}

/** 组合视图，保持 UI/IPC 层向后兼容 */
export interface SkillManifest extends SkillFrontmatter, SkillAppState {}

/** .index.json 磁盘结构 */
export interface SkillIndexFile {
  version: 1
  skills: Record<string, SkillAppState>
}

/** listSkills() 返回值 */
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
