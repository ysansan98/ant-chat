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
  formatObservation?: AgentTool['formatObservation']
  formatError?: AgentTool['formatError']
  truncateObservation?: boolean
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
    formatObservation: options.formatObservation,
    formatError: options.formatError,
    truncateObservation: options.truncateObservation,
    execute: async (input) => {
      try {
        return await options.execute(input)
      }
      catch (error) {
        if (error instanceof Error && error.message === WORKSPACE_INVALID_PATH) {
          return {
            ok: false,
            error: options.unrestricted
              ? AGENT_TOOL_EXEC_FAILED
              : `${AGENT_POLICY_BLOCKED}: path outside workspace`,
          }
        }
        return { ok: false, error: error instanceof Error ? error.message : AGENT_TOOL_EXEC_FAILED }
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
