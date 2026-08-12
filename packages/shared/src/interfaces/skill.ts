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

export type SkillSource = 'zip' | 'github' | 'builtin' | 'local'

/** 应用层可变状态（仅持久化在 .index.json 中） */
export interface SkillAppState {
  enabled: boolean
  builtin: boolean
  source: SkillSource
  sourceUrl?: string
  /** GitHub 导入时锁定的 commit 哈希，用于可复现/追溯安装版本。 */
  commitSha?: string
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

/** 统一 Skill 导入输入：ZIP 传文件 base64，GitHub 传仓库 URL，后端按 source 分发。 */
export type ImportSkillOptions
  = | { source: 'zip', zipBase64: string, name?: string }
    | { source: 'github', url: string, name?: string }

/** GitHub 仓库预览出的单个 skill（用于多 skill 仓库选择导入）。 */
export interface GithubSkillPreview {
  /** 仓库内相对路径（SKILL.md 所在目录），如 skills/engineering/code-review */
  path: string
  /** skill 名（目录名） */
  name: string
  /** 分类（路径倒数第三段），无分类目录时为 undefined */
  category?: string
  description: string
}

export interface ImportGithubSkillsResult {
  installed: SkillManifest[]
  /** 因重名或目录非法被跳过的 skill 路径 */
  skipped: string[]
}

export interface SetSkillEnabledOptions {
  name: string
  enabled: boolean
}

export interface DeleteSkillOptions {
  name: string
}
