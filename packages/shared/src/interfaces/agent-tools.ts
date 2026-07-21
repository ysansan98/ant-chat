import type { SecretRef } from '../schemas'

export type ToolOperationType = 'read' | 'write' | 'bash' | 'bash_read' | 'browser' | 'skill' | 'mcp'
export type ToolScope = 'workspace' | 'outside' | 'blocked'
export type AgentToolInput = Record<string, unknown>

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
  execute: (input: Record<string, unknown>) => Promise<AgentToolResult>
  truncateResult?: boolean
}

export interface BashToolInput {
  command: string
  /** 一句话说明命令目的，仅用于 UI 展示（消息列表工具 header），执行路径不读取 */
  description?: string
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
