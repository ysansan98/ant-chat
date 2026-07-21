import type { AgentTool, McpTool, RuntimeMcpClientHub } from '@ant-chat/shared'
import { DEFAULT_MCP_TOOL_NAME_SEPARATOR } from '@ant-chat/shared'

export function createMcpTools(clientHub: RuntimeMcpClientHub): AgentTool[] {
  const tools: AgentTool[] = []
  for (const conn of clientHub.connections) {
    if (conn.server.status !== 'connected')
      continue
    for (const mcpTool of conn.server.tools ?? []) {
      tools.push(createMcpTool(conn.server.name, mcpTool, clientHub))
    }
  }
  return tools
}

export function createMcpTool(
  serverName: string,
  mcpTool: McpTool,
  clientHub: RuntimeMcpClientHub,
): AgentTool {
  return {
    name: `${serverName}${DEFAULT_MCP_TOOL_NAME_SEPARATOR}${mcpTool.name}`,
    source: 'mcp',
    serverName,
    description: mcpTool.description,
    inputSchema: mcpTool.inputSchema,
    operationType: 'mcp',
    inferScope: () => 'external',
    execute: async (input) => {
      try {
        const result = await clientHub.callTool(serverName, mcpTool.name, input)
        const output = result.content
          .filter((c): c is { type: 'text', text: string } => c.type === 'text' && typeof c.text === 'string')
          .map(c => c.text)
          .join('\n')
        return { ok: !result.isError, result: output }
      }
      catch (error) {
        return { ok: false, result: error instanceof Error ? error.message : 'MCP_TOOL_EXEC_FAILED' }
      }
    },
  }
}
