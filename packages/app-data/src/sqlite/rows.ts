import type {
  AttachmentSchema,
  ConversationsSettingsSchema,
  IConversations,
  IMessage,
  LanguageModelUsage,
  McpToolCall,
  MessageContent,
  ModelInfo,
} from '@ant-chat/shared'
import {
  AttachmentSchema as AttachmentInput,
  ConversationsSettingsSchema as ConversationSettingsInput,
  LanguageModelUsageSchema,
  McpToolCallSchema,
  MessageContentSchema,
  ModelInfoSchema,
} from '@ant-chat/shared'
import { z } from 'zod'

export interface ConversationRow {
  id: string
  workspace_path: string | null
  title: string
  created_at: number
  updated_at: number
  settings: string
}

export interface MessageRow {
  id: string
  conv_id: string
  role: 'system' | 'user' | 'assistant'
  content: string
  created_at: number
  status: 'success' | 'error' | 'loading' | 'typing' | 'cancel'
  images: string | null
  attachments: string | null
  reasoning_content: string | null
  tool_calls: string | null
  model_info: string | null
  usage: string | null
}

const AttachmentListInput = z.array(AttachmentInput)
const ToolCallListInput = z.array(McpToolCallSchema)

export function mapConversationRow(row: ConversationRow): IConversations {
  return {
    id: row.id,
    workspacePath: row.workspace_path,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    settings: parseConversationSettings(row.settings),
  }
}

export function mapMessageRow(row: MessageRow): IMessage {
  return {
    id: row.id,
    convId: row.conv_id,
    role: row.role,
    content: parseMessageContent(row.content),
    createdAt: row.created_at,
    status: row.status,
    images: parseAttachmentList(row.images ?? '[]'),
    attachments: parseAttachmentList(row.attachments ?? '[]'),
    reasoningContent: row.reasoning_content ?? undefined,
    toolCalls: parseNullableToolCalls(row.tool_calls),
    modelInfo: parseNullableModelInfo(row.model_info),
    usage: parseNullableUsage(row.usage),
  }
}

export function stringifyJson(value: unknown): string {
  return JSON.stringify(value)
}

function parseConversationSettings(value: string): ConversationsSettingsSchema {
  return ConversationSettingsInput.parse(JSON.parse(value))
}

export function parseMessageContent(value: string): MessageContent {
  return MessageContentSchema.parse(JSON.parse(value))
}

function parseAttachmentList(value: string): AttachmentSchema[] {
  return AttachmentListInput.parse(JSON.parse(value))
}

function parseNullableToolCalls(value: string | null): McpToolCall[] | undefined {
  if (value === null)
    return undefined

  return ToolCallListInput.parse(JSON.parse(value))
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
