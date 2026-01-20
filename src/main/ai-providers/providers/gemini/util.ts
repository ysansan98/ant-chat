import type { McpTool } from '@ant-chat/shared'
import type { FunctionDeclaration } from '@google/genai'
import { Type } from '@google/genai'

/**
 * 将MCP工具定义转换为Gemini工具格式
 * @param mcpTools MCP工具定义数组
 * @returns Gemini工具格式的工具定义
 * @fork https://github.com/ThinkInAIXYZ/deepchat/blob/dev/src/main/presenter/mcpPresenter/index.ts#L515
 */
export function mcpToolsToGeminiTools(mcpTools: McpTool[]): FunctionDeclaration[] {
  if (!mcpTools || mcpTools.length === 0) {
    return []
  }

  // 递归清理Schema对象，确保符合Gemini API要求
  const cleanSchema = (schema: Record<string, unknown>): Record<string, unknown> => {
    const allowedTopLevelFields = ['type', 'description', 'enum', 'properties', 'items', 'nullable', 'anyOf']

    // 创建新对象，只保留允许的字段
    const cleanedSchema: Record<string, unknown> = {}

    // 处理允许的顶级字段
    for (const field of allowedTopLevelFields) {
      if (field in schema) {
        if (field === 'properties' && typeof schema.properties === 'object') {
          // 递归处理properties中的每个属性
          const properties = schema.properties as Record<string, unknown>
          const cleanedProperties: Record<string, unknown> = {}

          for (const [propName, propValue] of Object.entries(properties)) {
            if (typeof propValue === 'object' && propValue !== null) {
              cleanedProperties[propName] = cleanSchema(propValue as Record<string, unknown>)
            }
            else {
              cleanedProperties[propName] = propValue
            }
          }

          cleanedSchema.properties = cleanedProperties
        }
        else if (field === 'items' && typeof schema.items === 'object') {
          // 递归处理items对象
          cleanedSchema.items = cleanSchema(schema.items as Record<string, unknown>)
        }
        else if (field === 'anyOf' && Array.isArray(schema.anyOf)) {
          // 递归处理anyOf数组中的每个选项
          cleanedSchema.anyOf = (schema.anyOf as Array<Record<string, unknown>>).map(cleanSchema)
        }
        else {
          // 其他字段直接复制
          cleanedSchema[field] = schema[field]
        }
      }
    }

    return cleanedSchema
  }

  // 处理每个工具定义，构建符合Gemini API的函数声明
  const functionDeclarations = mcpTools.map((toolDef) => {
    // 转换为内部工具表示
    const tool = toolDef

    // 获取参数属性
    const properties = tool.inputSchema.properties
    const processedProperties: Record<string, Record<string, unknown>> = {}

    // 处理每个属性，应用清理函数
    for (const [propName, propValue] of Object.entries(properties)) {
      if (typeof propValue === 'object' && propValue !== null) {
        processedProperties[propName] = cleanSchema(propValue as Record<string, unknown>)
      }
    }

    // 准备函数声明结构
    const functionDeclaration = {
      name: tool.name,
      description: tool.description,
    } as FunctionDeclaration

    if (Object.keys(processedProperties).length > 0) {
      functionDeclaration.parameters = {
        type: Type.OBJECT,
        properties: processedProperties,
        required: tool.inputSchema.required || [],
      }
    }

    // 记录没有参数的函数
    if (Object.keys(processedProperties).length === 0) {
      console.log(`[MCP] 函数 ${tool.name} 没有参数，提供了最小化的参数结构`)
    }

    return functionDeclaration
  })

  return functionDeclarations
}
