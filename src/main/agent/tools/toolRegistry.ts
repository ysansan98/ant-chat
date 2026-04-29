import type { AgentMode, AgentTool, AgentToolResult, AgentToolRisk } from '@ant-chat/shared'
import { getNativeToolService } from '../native-tools/nativeToolService'

export interface PreparedToolCall {
  toolName: string
  input: Record<string, unknown>
  riskLevel: AgentToolRisk
  execute: () => Promise<AgentToolResult>
}

export interface RuntimeToolDefinition {
  name: string
  source: AgentTool['source']
  description?: string
  inputSchema: {
    type: 'object'
    properties: Record<string, Record<string, unknown>>
    required: string[]
  }
}

export class ToolRegistry {
  private readonly tools: Map<string, AgentTool>

  constructor(workspacePath: string, mode: AgentMode) {
    this.tools = new Map(getNativeToolService(workspacePath, mode === 'full_managed').getTools().map(tool => [tool.name, tool]))
  }

  prepare(toolName: string, input: Record<string, unknown>): PreparedToolCall {
    const tool = this.tools.get(toolName)
    if (!tool) {
      return {
        toolName,
        input,
        riskLevel: 'L2',
        execute: async () => ({ ok: false, error: 'AGENT_TOOL_EXEC_FAILED' }),
      }
    }

    return {
      toolName,
      input,
      riskLevel: safeInferRisk(tool, input),
      execute: () => tool.execute(input),
    }
  }

  listTools(): RuntimeToolDefinition[] {
    return [...this.tools.values()].map((tool) => {
      const schema = getNativeToolSchema(tool.name)
      return {
        name: tool.name,
        source: tool.source,
        description: schema.description,
        inputSchema: schema.inputSchema,
      }
    })
  }
}

function safeInferRisk(tool: AgentTool, input: Record<string, unknown>): AgentToolRisk {
  try {
    return tool.inferRisk(input)
  }
  catch {
    return 'L2'
  }
}

function getNativeToolSchema(name: string): { description: string, inputSchema: RuntimeToolDefinition['inputSchema'] } {
  switch (name) {
    case 'read_file':
      return {
        description: '读取文件内容，offset 为起始行号(1-based)，limit 为读取行数',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string' }, offset: { type: 'number' }, limit: { type: 'number' } },
          required: ['path'],
        },
      }
    case 'list_dir':
      return {
        description: '列出目录内容，支持 offset/limit 分页',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string' }, offset: { type: 'number' }, limit: { type: 'number' } },
          required: [],
        },
      }
    case 'glob_files':
      return {
        description: '按 glob 模式查找文件',
        inputSchema: {
          type: 'object',
          properties: { pattern: { type: 'string' }, path: { type: 'string' }, limit: { type: 'number' } },
          required: ['pattern'],
        },
      }
    case 'grep_files':
      return {
        description: '按正则搜索文件内容',
        inputSchema: {
          type: 'object',
          properties: { pattern: { type: 'string' }, path: { type: 'string' }, include: { type: 'string' }, limit: { type: 'number' } },
          required: ['pattern'],
        },
      }
    case 'write_file':
      return {
        description: '写入文件内容',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string' }, content: { type: 'string' } },
          required: ['path', 'content'],
        },
      }
    case 'apply_patch':
      return {
        description: '按自定义 patch 语法修改文件，必须使用 "*** Begin Patch" / "*** Update File" / "*** End Patch" 格式，不接受 git unified diff',
        inputSchema: {
          type: 'object',
          properties: { patch: { type: 'string' } },
          required: ['patch'],
        },
      }
    case 'bash':
      return {
        description: '执行 shell 命令',
        inputSchema: {
          type: 'object',
          properties: { command: { type: 'string' }, cwd: { type: 'string' }, timeoutMs: { type: 'number' } },
          required: ['command'],
        },
      }
    default:
      return {
        description: name,
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      }
  }
}
