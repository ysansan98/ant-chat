import type { MCPClientHub } from '@ant-chat/mcp-client-hub'
import type { AgentTool, McpTool } from '@ant-chat/shared'
import { DEFAULT_MCP_TOOL_NAME_SEPARATOR } from '@ant-chat/shared'

export function createMcpTools(clientHub: MCPClientHub): AgentTool[] {
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
  clientHub: MCPClientHub,
): AgentTool {
  return {
    name: `${serverName}${DEFAULT_MCP_TOOL_NAME_SEPARATOR}${mcpTool.name}`,
    source: 'mcp',
    serverName,
    description: mcpTool.description,
    inputSchema: mcpTool.inputSchema,
    operationType: 'mcp',
    inferScope: () => 'outside',
    execute: async (input) => {
      try {
        const result = await clientHub.callTool(serverName, mcpTool.name, input)
        const output = result.content
          .filter((c): c is { type: 'text', text: string } => c.type === 'text')
          .map(c => c.text)
          .join('\n')
        return { ok: !result.isError, output }
      }
      catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'MCP_TOOL_EXEC_FAILED' }
      }
    },
  }
}
