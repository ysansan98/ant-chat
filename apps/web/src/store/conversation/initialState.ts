import type { IConversations } from '@ant-chat/shared'

export interface ConversationsStoreState {
  /** 全部已加载会话的平铺列表（唯一真相），每条自带 workspacePath，按 updatedAt 降序。 */
  conversations: IConversations[]
  /** 各工作区会话总数（服务端 totals 初始化 + 本地增删修正）。 */
  conversationsTotal: Record<string, number>
  /** 会话运行时状态；无条目 = idle。 */
  conversationStates: Record<string, 'running' | 'completed'>
}

/** 工作区会话预览每页条数（"最近 N 条"）。 */
export const PAGE_SIZE = 5

export function createInitialState(): ConversationsStoreState {
  return {
    conversations: [],
    conversationsTotal: {},
    conversationStates: {},
  }
}

export const initialState: ConversationsStoreState = createInitialState()
