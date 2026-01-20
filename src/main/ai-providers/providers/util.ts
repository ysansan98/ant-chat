import type { McpToolCall } from '@ant-chat/shared'
import { uuid } from '@main/utils/util'

type CreateMcpToolCallOptions = Partial<Omit<McpToolCall, 'serverName' | 'toolName' | 'args'>> & Pick<McpToolCall, 'serverName' | 'toolName' | 'args'>

export function createMcpToolCall(options: CreateMcpToolCallOptions): McpToolCall {
  if (!options.serverName || !options.toolName || !options.args) {
    throw new Error('serverName, toolName and arguments are required')
  }

  return {
    id: uuid('functioncall-'),
    ...options,
    executeState: 'await',
  }
}
