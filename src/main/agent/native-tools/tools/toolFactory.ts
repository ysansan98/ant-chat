import type { AgentTool, ToolOperationType } from '@ant-chat/shared'
import { AGENT_POLICY_BLOCKED, AGENT_TOOL_EXEC_FAILED, WORKSPACE_INVALID_PATH } from '@ant-chat/shared'

interface CreateNativeToolOptions {
  name: string
  unrestricted: boolean
  inferScope: AgentTool['inferScope']
  execute: AgentTool['execute']
  validateInput?: AgentTool['validateInput']
}

export function createNativeTool(options: CreateNativeToolOptions): AgentTool {
  return {
    name: options.name,
    source: 'native',
    operationType: getToolOperationType(options.name),
    inferScope: options.inferScope,
    validateInput: options.validateInput,
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
    case 'write_file': case 'edit_file': case 'apply_patch':
      return 'write'
    case 'bash':
      return 'bash'
    default:
      return 'read'
  }
}
