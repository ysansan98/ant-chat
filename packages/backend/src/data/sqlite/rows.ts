import type {
  ConversationsSettingsSchema,
  IConversations,
  IMessage,
  LanguageModelUsage,
  MessageContent,
  ModelInfo,
} from '@ant-chat/shared'
import {
  ConversationsSettingsSchema as ConversationSettingsInput,
  DEFAULT_COMPACTION_SETTINGS,
  LanguageModelUsageSchema,
  MessageContentSchema,
  ModelInfoSchema,
} from '@ant-chat/shared'

export interface ConversationRow {
  id: string
  workspace_path: string | null
  title: string
  created_at: number
  updated_at: number
  archived?: number
  settings: string
}

export interface MessageRow {
  id: string
  conv_id: string
  role: string
  content: string
  created_at: number
  status: string
  reasoning_content: string | null
  model_info: string | null
  usage: string | null
  turn_id: string | null
  event_type: string | null
  compacted_through_message_id: string | null
  duration_ms: number | null
}

export function mapConversationRow(row: ConversationRow): IConversations {
  return {
    id: row.id,
    workspacePath: row.workspace_path,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archived: row.archived === 1,
    settings: parseConversationSettings(row.settings),
  }
}

export function mapMessageRow(row: MessageRow): IMessage {
  return {
    id: row.id,
    convId: row.conv_id,
    role: row.role as IMessage['role'],
    content: parseMessageContent(row.content),
    createdAt: row.created_at,
    status: row.status as IMessage['status'],
    reasoningContent: row.reasoning_content ?? undefined,
    modelInfo: parseNullableModelInfo(row.model_info),
    usage: parseNullableUsage(row.usage),
    turnId: row.turn_id ?? undefined,
    eventType: row.event_type ?? undefined,
    compactedThroughMessageId: row.compacted_through_message_id ?? undefined,
    durationMs: row.duration_ms ?? undefined,
  }
}

export function stringifyJson(value: unknown): string {
  return JSON.stringify(value)
}

function parseConversationSettings(value: string): ConversationsSettingsSchema {
  const settings = JSON.parse(value) as Record<string, unknown>
  const compaction = settings.compaction
  if (
    compaction
    && typeof compaction === 'object'
    && !Array.isArray(compaction)
    && !('keepRecentTokens' in compaction)
    && 'keepRecentPairs' in compaction
  ) {
    settings.compaction = {
      ...compaction,
      keepRecentTokens: DEFAULT_COMPACTION_SETTINGS.keepRecentTokens,
    }
    delete (settings.compaction as Record<string, unknown>).keepRecentPairs
  }
  // Default providerId for legacy data that predates the (providerId, modelId) split
  if (!settings.providerId) {
    settings.providerId = ''
  }
  return ConversationSettingsInput.parse(settings)
}

export function parseMessageContent(value: string): MessageContent {
  return MessageContentSchema.parse(JSON.parse(value))
}

function parseNullableModelInfo(value: string | null): ModelInfo | undefined {
  if (value === null)
    return undefined

  return ModelInfoSchema.parse(JSON.parse(value))
}

function parseNullableUsage(value: string | null): LanguageModelUsage | undefined {
  if (value === null)
    return undefined

  return LanguageModelUsageSchema.parse(JSON.parse(value))
}
