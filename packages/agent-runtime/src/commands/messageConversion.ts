import type { IMessage } from '@ant-chat/shared'

/**
 * Convert IMessage[] to LoopMessage[] for compaction input.
 * Filters to user/assistant/tool roles only (no events).
 */
export function messagesToLoopMessages(messages: IMessage[]): Array<{
  role: 'user' | 'assistant' | 'tool'
  content: Array<
    | { type: 'text', text: string }
    | { type: 'tool-call', toolCallId: string, toolName: string, args: Record<string, unknown> }
    | { type: 'tool-result', toolCallId: string, toolName: string, result: unknown, isError?: boolean }
  >
}> {
  return messages
    .filter(m => m.role === 'user' || m.role === 'assistant' || m.role === 'tool')
    .map(m => ({
      role: m.role as 'user' | 'assistant' | 'tool',
      content: m.content.filter(
        (b): b is
        | { type: 'text', text: string }
        | { type: 'tool-call', toolCallId: string, toolName: string, args: Record<string, unknown> }
        | { type: 'tool-result', toolCallId: string, toolName: string, result: unknown, isError?: boolean } =>
          b.type === 'text' || b.type === 'tool-call' || b.type === 'tool-result',
      ),
    }))
}
