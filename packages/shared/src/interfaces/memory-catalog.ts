/**
 * 长期记忆目录（MemoryCatalog）：人工批准的结论层。
 *
 * 与 AgentMemoryManager（SOUL/USER/MEMORY.md prompt 快照）职责分离：
 * - pending 可由 agent 提议，只有用户在 UI 明确批准后才变 active 并写 Markdown；
 * - 未批准/已归档记忆永不参与召回；
 * - 记忆正文按 canonical workspace identity 隔离在 app-data/memories/<workspace-key>/。
 */

export type MemoryStatus = 'pending' | 'active' | 'archived'

export interface MemoryRecord {
  id: string
  workspaceKey: string
  /** 仅供 UI 展示的原始工作区路径。 */
  workspacePath: string
  title: string
  summary: string
  /** app-managed 相对路径（memories root 之下）；pending 状态为空字符串。 */
  bodyPath: string
  bodySha256: string
  status: MemoryStatus
  createdAt: number
  approvedAt?: number
  archivedAt?: number
}

/** 证据视图：结论来源的精确消息定位（支持回跳）。 */
export interface MemoryEvidenceView {
  messageId: string
  conversationId: string
  conversationTitle: string
  ordinal: number
  role: string
  text: string
  createdAt: number
}

export interface MemoryHit {
  memory: MemoryRecord
  evidence: MemoryEvidenceView[]
}

/** UI 列表条目：记忆记录 + 可回跳的证据。 */
export interface MemoryCatalogListEntry {
  memory: MemoryRecord
  evidence: MemoryEvidenceView[]
}

export interface MemoryProposal {
  workspacePath: string
  title: string
  summary: string
  /** 记忆正文（Markdown），批准时写入文件。 */
  body: string
  /** 支撑结论的消息 ID（来自 search_messages/get_turn），至少一条。 */
  evidenceMessageIds: string[]
}

/** Agent 可用的 MemoryCatalog 能力面；UI 审批方法由后端模块另行暴露。 */
export interface MemoryCatalogPort {
  search: (input: { query: string, workspacePath: string, limit?: number }) => Promise<MemoryHit[]>
  propose: (input: MemoryProposal) => Promise<MemoryRecord>
  approve: (input: { memoryId: string }) => Promise<MemoryRecord>
  archive: (input: { memoryId: string }) => Promise<MemoryRecord>
}
