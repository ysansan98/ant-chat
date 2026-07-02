import type { AgentExecutionPhase, IMessage } from '@ant-chat/shared'

export interface TurnViewModel {
  id: string
  userMessage?: IMessage
  responseMessages: IMessage[]
  executionPhase?: AgentExecutionPhase
  status: 'running' | 'success' | 'error' | 'cancel'
}

export type ConversationItem
  = | { type: 'turn', turn: TurnViewModel }
    | { type: 'event', message: IMessage }

export function buildConversationItems(
  messages: IMessage[],
  executionPhaseByTurn: Record<string, AgentExecutionPhase>,
): ConversationItem[] {
  const items: ConversationItem[] = []
  const turns = new Map<string, TurnViewModel>()
  let latestTurn: TurnViewModel | undefined

  function ensureTurn(turnId: string): TurnViewModel {
    const existing = turns.get(turnId)
    if (existing)
      return existing

    const turn: TurnViewModel = {
      id: turnId,
      responseMessages: [],
      executionPhase: executionPhaseByTurn[turnId],
      status: executionPhaseByTurn[turnId] ? 'running' : 'success',
    }
    turns.set(turnId, turn)
    items.push({ type: 'turn', turn })
    return turn
  }

  for (const message of messages) {
    if (message.role === 'event') {
      items.push({ type: 'event', message })
      continue
    }

    if (message.role === 'user' && !message.turnId) {
      latestTurn = ensureTurn(message.id)
      latestTurn.userMessage = message
      continue
    }

    const turn = message.turnId
      ? ensureTurn(message.turnId)
      : latestTurn ?? ensureTurn(`orphan:${message.id}`)
    turn.responseMessages.push(message)
    latestTurn = turn
  }

  for (const turn of turns.values()) {
    if (turn.executionPhase) {
      turn.status = 'running'
      continue
    }
    const finalAssistant = turn.responseMessages.findLast(message => message.role === 'assistant')
    turn.status = finalAssistant?.status === 'error' || finalAssistant?.status === 'cancel'
      ? finalAssistant.status
      : 'success'
  }

  return items
}

export function getRootUserMessages(items: ConversationItem[]): IMessage[] {
  return items.flatMap(item => item.type === 'turn' && item.turn.userMessage
    ? [item.turn.userMessage]
    : [])
}
