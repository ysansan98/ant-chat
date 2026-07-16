export interface McpServer {
  name: string
  config: string
  status: 'connected' | 'connecting' | 'disconnected'
  error?: string
  tools?: McpTool[]
  resources?: McpResource[]
  resourceTemplates?: McpResourceTemplate[]
  disabled?: boolean
  timeout?: number
}

export interface McpTool {
  name: string
  description?: string
  inputSchema: {
    type: 'object'
    properties: Record<string, Record<string, unknown>>
    required: string[]
  }
}

export interface McpResource {
  uri: string
  name: string
  mimeType?: string
  description?: string
}

export interface McpResourceTemplate {
  uriTemplate: string
  name: string
  description?: string
  mimeType?: string
}

export type McpConnection = Pick<McpServer, 'name' | 'config' | 'status' | 'tools' | 'disabled'>

export interface McpServerLifecycleResult {
  serverName: string
  status: McpServer['status']
  transportType: 'stdio' | 'sse'
  error?: string
  /** 失败发生时，新配置是否已经持久化。 */
  configSaved?: boolean
}

export interface McpServerTestResult {
  serverName: string
  tools: McpTool[]
  error?: string
}

export interface TextResult {
  type: 'text'
  text: string
}

export interface ImageResult {
  type: 'image'
  data: string
  mimeType: string
}
export interface AudioResult {
  type: 'audio'
  data: string
  mimeType: string
}

export interface Resource {
  blob?: unknown
  mimeType?: string
  text: unknown
  uri: string
}

export interface resourceResult {
  type: 'resource'
  resource: Resource
}

export interface McpToolContentResult {
  type: string
  text?: string
}

/**
 * Mcp Tool 调用的响应结果
 */
export interface McpToolCallResponse {
  content: McpToolContentResult[]
  isError?: boolean
}
