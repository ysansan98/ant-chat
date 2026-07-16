import type { RunBuiltinCommandResult } from '@ant-chat/shared'
import type { ConversationLifecycle } from '../../conversations/conversationLifecycle'

export async function runFork(params: {
  conversationLifecycle: ConversationLifecycle
  sourceConversationId: string
  workspacePath: string
}): Promise<Extract<RunBuiltinCommandResult, { status: 'success' }>> {
  const { conversationLifecycle, sourceConversationId, workspacePath } = params
  const forkConversation = await conversationLifecycle.fork({ sourceConversationId, workspacePath })

  return { status: 'success', conversation: forkConversation, conversationId: forkConversation.id }
}
