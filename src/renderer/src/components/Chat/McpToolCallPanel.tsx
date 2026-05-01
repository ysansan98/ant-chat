import type { IMcpToolCall } from '@ant-chat/shared'
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from '@workspace/ui/components/ai-elements/tool'

interface McpToolCallPanelProps {
  item: IMcpToolCall
}

export function McpToolCallPanel({ item }: McpToolCallPanelProps) {
  const state = item.executeState === 'await'
    ? 'approval-requested'
    : item.executeState === 'executing'
      ? 'input-available'
      : item.result?.success
        ? 'output-available'
        : 'output-error'

  return (
    <Tool defaultOpen={item.executeState !== 'completed'} className="mb-0">
      <ToolHeader
        type="dynamic-tool"
        state={state}
        toolName={item.serverName}
        title={item.toolName}
        className="min-w-0 flex-1"
      />
      <ToolContent>
        <ToolInput input={item.args} />
        <ToolOutput
          output={item.result?.success ? item.result.data : undefined}
          errorText={item.result?.success ? undefined : item.result?.error}
        />
      </ToolContent>
    </Tool>
  )
}
