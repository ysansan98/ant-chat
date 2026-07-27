import type { AgentTool, AgentToolResult, ToolOperationType, ToolScope } from '@ant-chat/shared'
import { AGENT_POLICY_BLOCKED, AGENT_TOOL_EXEC_FAILED, WORKSPACE_INVALID_PATH } from '@ant-chat/shared'

export interface NativeToolPreparation {
  scope: ToolScope
  operationType?: ToolOperationType
  state?: unknown
  execute: (input: Record<string, unknown>) => Promise<AgentToolResult>
  executeRelaxed?: (input: Record<string, unknown>) => Promise<AgentToolResult>
}

export interface PreparedNativeTool extends AgentTool {
  prepare?: (input: Record<string, unknown>) => NativeToolPreparation
}

interface CreateNativeToolOptions {
  name: string
  description: string
  inputSchema: NonNullable<AgentTool['inputSchema']>
  operationType?: ToolOperationType
  unrestricted: boolean
  inferScope: AgentTool['inferScope']
  execute: AgentTool['execute']
  validateInput?: AgentTool['validateInput']
  truncateResult?: boolean
  prepare?: (input: Record<string, unknown>) => NativeToolPreparation
}

export function createNativeTool(options: CreateNativeToolOptions): PreparedNativeTool {
  const executeSafely = async (execute: () => Promise<AgentToolResult>): Promise<AgentToolResult> => {
    try {
      return await execute()
    }
    catch (error) {
      if (error instanceof Error && error.message === WORKSPACE_INVALID_PATH) {
        return {
          ok: false,
          result: options.unrestricted
            ? '工具执行失败：访问了无效路径。'
            : '工具执行失败：路径不在允许的工作区范围内。',
          diagnostics: { data: { code: options.unrestricted ? AGENT_TOOL_EXEC_FAILED : AGENT_POLICY_BLOCKED } },
        }
      }
      return { ok: false, result: error instanceof Error ? error.message : '工具执行失败。' }
    }
  }

  return {
    name: options.name,
    source: 'native',
    description: options.description,
    inputSchema: options.inputSchema,
    operationType: options.operationType ?? getToolOperationType(options.name),
    inferScope: options.inferScope,
    validateInput: options.validateInput,
    truncateResult: options.truncateResult,
    execute: input => executeSafely(() => options.execute(input)),
    prepare: options.prepare
      ? (input) => {
          const preparation = options.prepare!(input)
          return {
            ...preparation,
            execute: preparedInput => executeSafely(() => preparation.execute(preparedInput)),
            executeRelaxed: preparation.executeRelaxed
              ? preparedInput => executeSafely(() => preparation.executeRelaxed!(preparedInput))
              : undefined,
          }
        }
      : undefined,
  }
}

function getToolOperationType(name: string): ToolOperationType {
  switch (name) {
    case 'read_file': case 'list_dir': case 'glob_files': case 'grep_files':
      return 'read'
    case 'write_file': case 'edit_file':
      return 'write'
    case 'execute_command':
      return 'command'
    case 'browser':
      return 'browser'
    default:
      return 'read'
  }
}
