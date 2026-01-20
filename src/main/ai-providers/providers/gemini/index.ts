import type { CreateConversationTitleOptions, IAttachment, IMcpToolCall, IMessage, MessageContent, SendChatCompletionsOptions } from '@ant-chat/shared'
import type { GenerateContentParameters, Part, Tool } from '@google/genai'
import type { AIProvider, ProviderOptions } from '../interface'
import { DEFAULT_MCP_TOOL_NAME_SEPARATOR } from '@ant-chat/shared'
import { FunctionCallingConfigMode, GoogleGenAI } from '@google/genai'
import { logger } from '@main/utils/logger'
import { uuid } from '@main/utils/util'
import { createMcpToolCall } from '../util'
import { mcpToolsToGeminiTools } from './util'

class GeminiService implements AIProvider {
  private client: GoogleGenAI

  // MCP 工具名称分隔符的默认值
  protected mcpToolNameSeparator = DEFAULT_MCP_TOOL_NAME_SEPARATOR

  // 用于生成图像的模型
  protected readonly generativeImageModels = ['gemini-2.0-flash-exp-image-generation']

  constructor(options: ProviderOptions) {
    // GoogleGenAI会自动使用环境变量中的代理设置 (HTTP_PROXY, HTTPS_PROXY)
    // 无需手动配置代理
    this.client = new GoogleGenAI({
      apiKey: options.apiKey,
      httpOptions: { baseUrl: options.baseUrl },
    })

    logger.info(`Gemini client initialized for ${options.baseUrl}`)
    logger.info(`Using proxy: ${process.env.HTTP_PROXY || 'none'}`)
  }

  async createConversationTitle(options: CreateConversationTitleOptions) {
    const { context, model } = options

    const resp = await this.client.models.generateContent({
      model,
      contents: [
        { parts: [{ text: context }], role: 'user' },
      ],
    })
    return resp.text ?? ''
  }

  async* sendChatCompletions(options: SendChatCompletionsOptions) {
    const params: GenerateContentParameters = this.buildCompleteParameters(options)
    const stream = await this.client.models.generateContentStream(params)

    for await (const chunk of stream) {
      const content: MessageContent = []
      const functioncalls: IMcpToolCall[] = []

      chunk?.candidates?.[0].content?.parts?.forEach((part) => {
        if (part.text) {
          content.push({ type: 'text', text: part.text })
        }
        else if (part.inlineData) {
          const { mimeType = '', data = '' } = part.inlineData
          if (mimeType.startsWith('image/') && data) {
            content.push({
              type: 'image',
              mimeType,
              data,
            })
          }
        }
        else if (part.functionCall) {
          const { name = '', id = uuid('functionCall-'), args = {} } = part.functionCall
          const [serverName, toolName] = name.split(this.mcpToolNameSeparator)
          functioncalls.push(
            createMcpToolCall({ id, serverName, toolName, args }),
          )
        }
      })

      yield {
        content,
        reasoningContent: '',
        functionCalls: functioncalls.length > 0 ? functioncalls : undefined,
      }
    }
  }

  protected buildCompleteParameters(options: SendChatCompletionsOptions): GenerateContentParameters {
    const { messages } = options
    const params: GenerateContentParameters = {
      model: options.chatSettings.model,
      contents: this.transformMessages(messages),
      config: {
        temperature: options.chatSettings.temperature,
        maxOutputTokens: options.chatSettings.maxTokens,
        abortSignal: options.abortSignal,
      },
    }

    // generativeImageModels中的模型不支持系统提示词
    if (options.chatSettings.systemPrompt.length > 0 && !this.generativeImageModels.includes(options.chatSettings.model)) {
      params.config!.systemInstruction = { parts: [{ text: options.chatSettings.systemPrompt }] }
    }

    if (options.chatSettings.features.onlineSearch) {
      params.config!.tools = [{ googleSearch: {} }]
    }

    if (options.chatSettings.features.enableMCP) {
      if (params.config!.tools === undefined) {
        params.config!.tools = []
      }
      const functionDeclarations: Tool = {
        functionDeclarations: [],
      }

      // 转换可用的MCP工具
      functionDeclarations.functionDeclarations = mcpToolsToGeminiTools(options.mcpTools ?? [])

      params.config?.tools.push(functionDeclarations)

      params.config!.toolConfig = {
        functionCallingConfig: {
          mode: FunctionCallingConfigMode.AUTO,
        },
      }
    }

    // 如果是用于生成图像的模型，添加 responseModalities
    if (this.generativeImageModels.includes(options.chatSettings.model)) {
      params.config!.responseModalities = ['TEXT', 'IMAGE']
    }
    return params
  }

  protected transformMessages(messages: IMessage[]): GenerateContentParameters['contents'] {
    const result: GenerateContentParameters['contents'] = []

    messages.forEach((msg) => {
      if (msg.role === 'user') {
        msg.content.forEach((content) => {
          if (content.type === 'text') {
            result.push({ role: 'user', parts: [
              { text: content.text },
              ...this.transformFilePart((msg.images ?? []).concat(msg.attachments ?? [])),
            ] })
          }
        })
      }
      else if (msg.role === 'assistant') {
        const parts: Part[] = []

        msg.content.forEach((content) => {
          if (content.type === 'text') {
            parts.push({ text: content.text })
          }
          else if (content.type === 'image') {
            parts.push({
              inlineData: {
                mimeType: content.mimeType,
                data: content.data,
              },
            })
          }
        })

        if (parts.length) {
          result.push({ role: 'assistant', parts })
        }

        // 处理MCP
        if (msg.mcpTool) {
          const mcpMessages = this.transformMcpToolToMessage(msg.mcpTool)
          result.push(...mcpMessages)
        }
      }
    })

    return result
  }

  protected transformFilePart(attachments: IAttachment[]) {
    return attachments.map((item) => {
      const { type: mimeType, data } = item
      const _data = data.replace(`data:${mimeType};base64,`, '')
      return { inlineData: { mimeType, data: _data } }
    })
  }

  protected transformMcpToolToMessage(tools: IMcpToolCall[]) {
    const result: GenerateContentParameters['contents'] = []
    for (const tool of tools) {
      const { serverName, toolName, args } = tool
      const name = serverName + this.mcpToolNameSeparator + toolName
      result.push({
        role: 'model',
        parts: [
          {
            functionCall: {
              name,
              args,
            },
          },
        ],
      })

      if (tool.result) {
        result.push({
          role: 'user',
          parts: [
            {
              functionResponse: {
                name,
                response: {
                  result: (tool.result.success ? tool.result.data : tool.result.error),
                },
              },
            },
          ],
        })
      }
    }
    return result
  }
}

export default GeminiService
