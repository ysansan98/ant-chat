import type { AgentExecutionPhase, IMessage } from '@ant-chat/shared'
import type { TurnViewModel } from './conversationItems'
import { Shimmer } from '@workspace/ui/components/ai-elements/shimmer'
import { MessageBubble } from './MessageBubble'

const executionStatusText: Record<AgentExecutionPhase, string> = {
  waiting_model: '等待模型回复',
  thinking: '思考中',
  generating_response: '生成回复中',
  preparing_tool: '准备使用工具',
  using_tool: '正在使用工具',
}

interface ConversationTurnProps {
  turn: TurnViewModel
  onCopyMessage: (message: IMessage) => void
}

export function ConversationTurn({ turn, onCopyMessage }: ConversationTurnProps) {
  const status = turn.status === 'running' && turn.executionPhase
    ? <ExecutionStatus phase={turn.executionPhase} />
    : null

  return (
    <div className="space-y-5" data-turn-id={turn.id}>
      {turn.userMessage && (
        <MessageBubble messages={[turn.userMessage]} onCopyMessage={onCopyMessage} />
      )}

      {turn.responseMessages.length > 0 && (
        <MessageBubble
          messages={turn.responseMessages}
          onCopyMessage={onCopyMessage}
          turnStatus={status}
        />
      )}

      {turn.responseMessages.length === 0 && status && (
        <div className="mx-auto w-full max-w-(--chat-width)">
          {status}
        </div>
      )}
    </div>
  )
}

function ExecutionStatus({ phase }: { phase: AgentExecutionPhase }) {
  return (
    <div className="flex h-5 items-center text-xs" role="status" aria-live="polite">
      <Shimmer duration={1.6}>{executionStatusText[phase]}</Shimmer>
    </div>
  )
}
