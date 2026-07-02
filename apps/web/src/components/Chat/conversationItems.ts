import type { AgentExecutionPhase, IMessage } from '@ant-chat/shared'

export interface TurnViewModel {
  id: string
  userMessage?: IMessage
  responseMessages: IMessage[]
  executionPhase?: AgentExecutionPhase
  status: 'running' | 'success' | 'error' | 'cancel'
}

export type ConversationItem
  = | { type: 'turn', key: string, turn: TurnViewModel }
    | { type: 'event', message: IMessage }

export function buildConversationItems(
  messages: IMessage[],
  executionPhaseByTurn: Record<string, AgentExecutionPhase>,
): ConversationItem[] {
  const items: ConversationItem[] = []
  const currentTurnById = new Map<string, TurnViewModel>()
  const turnSegmentsById = new Map<string, TurnViewModel[]>()
  let latestTurn: TurnViewModel | undefined

  function ensureTurn(turnId: string): TurnViewModel {
    const existing = currentTurnById.get(turnId)
    if (existing)
      return existing

    const segments = turnSegmentsById.get(turnId) ?? []
    const turn: TurnViewModel = {
      id: turnId,
      responseMessages: [],
      status: 'success',
    }
    segments.push(turn)
    turnSegmentsById.set(turnId, segments)
    currentTurnById.set(turnId, turn)
    items.push({ type: 'turn', key: `${turnId}:${segments.length - 1}`, turn })
    return turn
  }

  for (const message of messages) {
    if (message.role === 'event') {
      items.push({ type: 'event', message })
      // 系统事件在消息流中拥有独立时间位置，事件后的消息不能回填到事件前的渲染片段。
      currentTurnById.clear()
      latestTurn = undefined
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

  for (const [turnId, segments] of turnSegmentsById) {
    const executionPhase = executionPhaseByTurn[turnId]
    for (const [index, turn] of segments.entries()) {
      if (executionPhase && index === segments.length - 1) {
        turn.executionPhase = executionPhase
        turn.status = 'running'
        continue
      }
      const finalAssistant = turn.responseMessages.findLast(message => message.role === 'assistant')
      turn.status = finalAssistant?.status === 'error' || finalAssistant?.status === 'cancel'
        ? finalAssistant.status
        : 'success'
    }
  }

  return items
}

export function getRootUserMessages(items: ConversationItem[]): IMessage[] {
  return items.flatMap(item => item.type === 'turn' && item.turn.userMessage
    ? [item.turn.userMessage]
    : [])
}
