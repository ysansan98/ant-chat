import type { AddConversationsSchema, ConversationsId, ConversationsSettingsSchema, IMessageAI, IMessageUser } from '@ant-chat/shared'
import type { RequireKey } from '@/types/global'
import { DEFAULT_TITLE, Role } from '@/constants'
import { getNow } from '@/utils'

// ============================ Conversations ============================
export function createConversations(option?: Partial<AddConversationsSchema>): AddConversationsSchema {
  const time = getNow()

  return Object.assign({
    title: DEFAULT_TITLE,
    createdAt: time,
    updatedAt: time,
    settings: {} as ConversationsSettingsSchema,
  }, option)
}

// ============================ Message ============================
function createMessageBase<T extends Role = Role.USER>(role: T) {
  return {
    convId: '' as ConversationsId,
    role,
    content: [],
    createAt: getNow(),
  }
}

export function createUserMessage(option: RequireKey<Partial<IMessageUser>, 'convId'>): IMessageUser {
  return Object.assign(
    createMessageBase(Role.USER),
    {
      status: 'success',
      attachments: [],
      images: [],
    },
    option,
  )
}

export function createAIMessage(option: RequireKey<Partial<IMessageAI>, 'convId'>): IMessageAI {
  return Object.assign(
    createMessageBase(Role.AI),
    {
      status: 'success',
    },
    option,
  )
}
