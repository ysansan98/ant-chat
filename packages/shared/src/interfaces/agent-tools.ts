import type { SecretRef } from '../schemas'

export type ToolOperationType = 'read' | 'write' | 'bash' | 'browser' | 'skill' | 'mcp'
export type ToolScope = 'workspace' | 'outside' | 'blocked'

export interface AgentToolResult {
  ok: boolean
  output?: unknown
  stdout?: string
  stderr?: string
  exitCode?: number
  durationMs?: number
  error?: string
}

export interface ToolResultView {
  output?: unknown
  stdout?: string
  stderr?: string
  exitCode?: number
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
  execute: (input: Record<string, unknown>) => Promise<AgentToolResult>
  formatObservation?: (result: ToolResultView, outputText: string) => string
  formatError?: (error: string, input: Record<string, unknown>, result?: ToolResultView) => string | undefined
  truncateObservation?: boolean
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

export const WORKSPACE_INVALID_PATH = 'WORKSPACE_INVALID_PATH'
export const WORKSPACE_DUPLICATED_PATH = 'WORKSPACE_DUPLICATED_PATH'
export const AGENT_POLICY_BLOCKED = 'AGENT_POLICY_BLOCKED'
export const AGENT_TOOL_EXEC_FAILED = 'AGENT_TOOL_EXEC_FAILED'
export const AGENT_SKILL_INVALID = 'AGENT_SKILL_INVALID'
export const AGENT_BASH_COMMAND_BLOCKED = 'AGENT_BASH_COMMAND_BLOCKED'
export const AGENT_BASH_TIMEOUT = 'AGENT_BASH_TIMEOUT'
