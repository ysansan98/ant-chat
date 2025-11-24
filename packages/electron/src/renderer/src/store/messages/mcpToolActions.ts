import type { IMcpToolCall, IMessage, McpToolCallResponse, MessageId } from '@ant-chat/shared'
import { dbApi } from '@/api/dbApi'
import { executeMcpToolCall } from '@/api/mcpApi'
import { addStreamingConversationId, removeStreamingConversationId } from '../conversation'
import { updateMessageAction } from './actions'

export async function setMcpToolCallexecuteState(id: MessageId, toolId: string, state: IMcpToolCall['executeState']) {
  const message = await dbApi.getMessageById(id)
  if (!message) {
    throw new Error('message not found')
  }
  if (!message.mcpTool) {
    throw new Error('message not has mcpTool')
  }
  const toolIndex = message.mcpTool.findIndex(item => item.id === toolId)

  if (toolIndex < 0) {
    throw new Error('mcp tool not found')
  }

  message.mcpTool[toolIndex].executeState = state

  await updateMessageAction(message)
}

export async function executeMcpToolAction(message: IMessage, tool: IMcpToolCall) {
  await setMcpToolCallexecuteState(message.id, tool.id, 'executing')
  addStreamingConversationId(message.convId)

  if (!message.mcpTool) {
    throw new Error('message not has mcpTool')
  }

  let mcpToolCallResponse: null | McpToolCallResponse = null

  try {
    mcpToolCallResponse = await executeMcpToolCall(tool)
  }
  catch (e) {
    const error = e as Error
    console.error(error)

    mcpToolCallResponse = {
      isError: true,
      content: [{
        type: 'text',
        text: error.message,
      }],
    }
  }

  const result = createMcpToolCallResponse(mcpToolCallResponse)

  const toolIndex = message.mcpTool?.findIndex(item => item.id === tool.id)

  const newMessage: IMessage = structuredClone(message)

  newMessage.mcpTool![toolIndex].result = result

  await updateMessageAction(newMessage)

  await setMcpToolCallexecuteState(message.id, tool.id, 'completed')
  removeStreamingConversationId(message.convId)

  // 检查当前message.mcpTool是否都执行完了
  const messageLatest = await dbApi.getMessageById(message.id)
  const isAllCompleted = messageLatest.mcpTool?.every(item => item.executeState === 'completed')

  return { isAllCompleted }
}

export function createMcpToolCallResponse(mcpToolCallResponse: McpToolCallResponse) {
  const { isError, content } = mcpToolCallResponse

  const result = {
    success: !isError,
    data: '',
    error: '',
  }

  if (isError) {
    result.error = content[0].text
  }
  else {
    result.data = content[0].text
  }

  return result
}
