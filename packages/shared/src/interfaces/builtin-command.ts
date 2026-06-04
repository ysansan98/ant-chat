import type { IConversations } from './db-types'

export interface BuiltinCommand {
  /** Unique command identifier, e.g. "compact", "new", "fork" */
  id: string
  /** Display title shown in the / panel */
  title: string
  /** Short description shown in the / panel */
  description: string
  /** Usage hint, e.g. "/compact [instruction]" */
  usage: string
  /** Whether the command accepts a text argument */
  allowArgument: boolean
  /** Whether the command requires an active conversation */
  requiresConversation: boolean
  /** Whether the command blocks the input while running */
  blocksInput: boolean
}

export const BUILTIN_COMMANDS: BuiltinCommand[] = [
  {
    id: 'compact',
    title: 'Compact',
    description: '压缩当前会话上下文，可附带保留/忽略指导',
    usage: '/compact [instruction]',
    allowArgument: true,
    requiresConversation: true,
    blocksInput: true,
  },
  {
    id: 'new',
    title: 'New',
    description: '创建一个新的空白会话',
    usage: '/new',
    allowArgument: false,
    requiresConversation: false,
    blocksInput: false,
  },
  {
    id: 'fork',
    title: 'Fork',
    description: '基于当前会话复制一个新会话',
    usage: '/fork',
    allowArgument: false,
    requiresConversation: true,
    blocksInput: false,
  },
]

export interface RunBuiltinCommandParams {
  id: string
  conversationId?: string
  argument?: string
  modelConfig: {
    modelId: string
    systemPrompt: string
    temperature: number
    maxTokens: number
  }
  workspacePath: string
}

export type RunBuiltinCommandResult
  = | {
    status: 'success'
    /** For /new and /fork: the created conversation */
    conversation?: IConversations
    /** For /new and /fork: the new conversation id */
    conversationId?: string
    /** For /compact: compaction summary text */
    summaryText?: string
  }
  | {
    status: 'error'
    /** Error detail when status is 'error'. */
    errorMessage: string
    /** For /compact: error text persisted in the event message. */
    summaryText?: string
  }
  | {
    status: 'cancelled'
    summaryText?: string
  }
