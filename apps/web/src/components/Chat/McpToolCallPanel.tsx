import type { ToolCallContent, ToolResultContent } from '@ant-chat/shared'
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from '@workspace/ui/components/ai-elements/tool'

interface McpToolCallPanelProps {
  toolCall?: ToolCallContent
  toolResult?: ToolResultContent
}

export function McpToolCallPanel({ toolCall, toolResult }: McpToolCallPanelProps) {
  // tool-result 作为独立消息展示（无对应 tool-call 时）
  if (toolResult && !toolCall) {
    return (
      <Tool defaultOpen={false} className="mb-0">
        <ToolHeader
          type="dynamic-tool"
          state={toolResult.isError ? 'output-error' : 'output-available'}
          toolName={toolResult.toolName}
          title={toolResult.toolName}
          className="min-w-0 flex-1"
        />
        <ToolContent>
          <ToolOutput
            output={toolResult.isError ? undefined : String(toolResult.result)}
            errorText={toolResult.isError ? String(toolResult.result) : undefined}
          />
        </ToolContent>
      </Tool>
    )
  }

  if (!toolCall)
    return null

  // tool-call + 可选的 tool-result
  const hasResult = !!toolResult
  const state = hasResult
    ? (toolResult!.isError ? 'output-error' : 'output-available')
    : 'input-available'

  return (
    <Tool defaultOpen={!hasResult} className="mb-0">
      <ToolHeader
        type="dynamic-tool"
        state={state}
        toolName={toolCall.serverName || toolCall.toolName}
        title={toolCall.toolName}
        className="min-w-0 flex-1"
      />
      <ToolContent>
        <ToolInput input={toolCall.args} />
        {toolResult && (
          <ToolOutput
            output={toolResult.isError ? undefined : String(toolResult.result)}
            errorText={toolResult.isError ? String(toolResult.result) : undefined}
          />
        )}
      </ToolContent>
    </Tool>
  )
}
