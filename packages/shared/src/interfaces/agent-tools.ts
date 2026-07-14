import type { SecretRef } from '../schemas'

export type ToolOperationType = 'read' | 'write' | 'bash' | 'browser' | 'skill' | 'mcp'
export type ToolScope = 'workspace' | 'outside' | 'blocked'
export type AgentToolInput = Record<string, unknown>
export type AgentToolPublicInput = Record<string, unknown>
export type AgentToolPublicInputMapper = (rawInput: AgentToolInput) => AgentToolPublicInput

export interface ToolDiagnostics {
  stdout?: string
  stderr?: string
  exitCode?: number
  durationMs?: number
  data?: unknown
}

export interface AgentToolResult {
  ok: boolean
  result: string
  diagnostics?: ToolDiagnostics
}

export interface AgentTool {
  name: string
  source: 'mcp' | 'native' | 'skill'
  serverName?: string
  description?: string
  inputSchema?: {
    type: 'object'
    properties: Record<string, Record<string, unknown>>
    required: string[]
  }
  operationType: ToolOperationType
  inferScope: (input: Record<string, unknown>) => ToolScope
  validateInput?: (input: Record<string, unknown>) => string | null
  toPublicInput?: AgentToolPublicInputMapper
  execute: (input: Record<string, unknown>) => Promise<AgentToolResult>
  truncateResult?: boolean
}

export interface BashToolInput {
  command: string
  cwd?: string
  timeoutMs?: number
  env?: Record<string, string | SecretRef>
}

export interface BrowserToolInput {
  command: string
  args?: string[]
  timeoutMs?: number
}

export interface ReadFileToolInput {
  path: string
  offset?: number
  limit?: number
}

export interface ListDirToolInput {
  path?: string
  offset?: number
  limit?: number
}

export interface GlobFilesToolInput {
  pattern: string
  path?: string
  limit?: number
}

export interface GrepFilesToolInput {
  pattern: string
  path?: string
  include?: string
  limit?: number
}

export interface WriteFileToolInput {
  path: string
  content: string
}

export interface EditFileToolInput {
  path: string
  edits: Array<{
    oldText: string
    newText: string
  }>
}
