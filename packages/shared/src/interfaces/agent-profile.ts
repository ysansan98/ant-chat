export interface AgentProfileFiles {
  profileRootPath: string
  userMarkdown: string
  memoryMarkdown: string
  soulMarkdown: string
  lastSoulUpdate?: SoulUpdateMeta
}

export interface SoulUpdateMeta {
  updatedAt: number
  summary: string
  backupPath: string
}

export interface UpdateAgentProfileInput {
  userMarkdown?: string
  memoryMarkdown?: string
  soulMarkdown?: string
}

export type AgentMemoryTarget = 'memory' | 'user'

export type AgentMemoryAction = 'add' | 'replace' | 'remove'

export interface AgentMemoryEditInput {
  target: AgentMemoryTarget
  action: AgentMemoryAction
  content?: string
  old_text?: string
}

export interface AgentMemoryEditResult {
  success: boolean
  target: AgentMemoryTarget
  entries: string[]
  usage: string
}

export interface SoulWriteInput {
  content: string
  summary: string
}

export interface SoulWriteResult {
  updated: boolean
  meta?: SoulUpdateMeta
}

export interface AgentProfileReader {
  readUserProfile: () => Promise<string>
  readMemory: () => Promise<string>
  readSoul: () => Promise<string>
  editMemory: (input: AgentMemoryEditInput) => Promise<AgentMemoryEditResult>
  updateSoul: (input: SoulWriteInput) => Promise<SoulWriteResult>
}
