import type { IMessage } from '@ant-chat/shared'

export function groupMessages(messages: IMessage[]): IMessage[][] {
  const groups: IMessage[][] = []
  const turnGroups = new Map<string, IMessage[]>()

  for (const message of messages) {
    if (message.role === 'event' || (message.role === 'user' && !message.turnId)) {
      groups.push([message])
      continue
    }

    if (message.turnId) {
      const existingGroup = turnGroups.get(message.turnId)
      if (existingGroup) {
        existingGroup.push(message)
      }
      else {
        const group = [message]
        turnGroups.set(message.turnId, group)
        groups.push(group)
      }
      continue
    }

    const lastGroup = groups.at(-1)
    const lastMessage = lastGroup?.at(-1)
    if (lastGroup && lastMessage?.role !== 'user' && lastMessage?.role !== 'event') {
      lastGroup.push(message)
    }
    else {
      groups.push([message])
    }
  }

  return groups
}

export function getRootUserMessages(messages: IMessage[]): IMessage[] {
  return messages.filter(message => message.role === 'user' && !message.turnId)
}
