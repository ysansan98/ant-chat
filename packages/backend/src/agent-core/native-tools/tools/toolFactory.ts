import type { AgentTool, ToolOperationType } from '@ant-chat/shared'
import { AGENT_POLICY_BLOCKED, AGENT_TOOL_EXEC_FAILED, WORKSPACE_INVALID_PATH } from '@ant-chat/shared'

interface CreateNativeToolOptions {
  name: string
  description: string
  inputSchema: NonNullable<AgentTool['inputSchema']>
  unrestricted: boolean
  inferScope: AgentTool['inferScope']
  execute: AgentTool['execute']
  validateInput?: AgentTool['validateInput']
  truncateResult?: boolean
}

export function createNativeTool(options: CreateNativeToolOptions): AgentTool {
  return {
    name: options.name,
    source: 'native',
    description: options.description,
    inputSchema: options.inputSchema,
    operationType: getToolOperationType(options.name),
    inferScope: options.inferScope,
    validateInput: options.validateInput,
    truncateResult: options.truncateResult,
    execute: async (input) => {
      try {
        return await options.execute(input)
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
    },
  }
}

function getToolOperationType(name: string): ToolOperationType {
  switch (name) {
    case 'read_file': case 'list_dir': case 'glob_files': case 'grep_files':
      return 'read'
    case 'write_file': case 'edit_file':
      return 'write'
    case 'bash':
      return 'bash'
    case 'browser':
      return 'browser'
    default:
      return 'read'
  }
}
