import type { AgentMode } from './agent-runtime'
import { z } from 'zod'

export const ChannelTypeSchema = z.enum(['feishu', 'weixin'])
export type ChannelType = z.infer<typeof ChannelTypeSchema>

export const ConversationSourceTypeSchema = z.enum(['local', 'feishu', 'weixin', 'wecom'])
export type ConversationSourceType = z.infer<typeof ConversationSourceTypeSchema>

export const ChannelOriginSchema = z.object({
  type: z.enum(['feishu', 'weixin']),
  channelAccountId: z.string().min(1),
  externalChatId: z.string().min(1),
  externalMessageId: z.string().min(1),
})
export type ChannelOrigin = z.infer<typeof ChannelOriginSchema>

export const ChannelAccountStatusSchema = z.enum(['configured', 'connecting', 'connected', 'degraded', 'disconnected'])
export type ChannelAccountStatus = z.infer<typeof ChannelAccountStatusSchema>

export const ChannelPairingStatusSchema = z.enum(['pending', 'authorized', 'revoked', 'expired'])
export type ChannelPairingStatus = z.infer<typeof ChannelPairingStatusSchema>

export const ChannelReceiptDirectionSchema = z.enum(['inbound', 'outbound'])
export type ChannelReceiptDirection = z.infer<typeof ChannelReceiptDirectionSchema>
export const ChannelReceiptStatusSchema = z.enum(['received', 'sent', 'failed'])
export type ChannelReceiptStatus = z.infer<typeof ChannelReceiptStatusSchema>

export interface ChannelAccount {
  id: string
  channelType: ChannelType
  displayName: string
  credentialRef: string
  defaultWorkspacePath: string | null
  permissionMode: AgentMode
  enabled: boolean
  status: ChannelAccountStatus
  lastError?: string
  createdAt: number
  updatedAt: number
}

export type ChannelAccountView = Omit<ChannelAccount, 'credentialRef'> & { hasCredential: boolean }

export interface ChannelSetupResult {
  setupId: string
  channelType: ChannelType
  status: 'awaiting_scan' | 'polling' | 'completed' | 'failed' | 'expired'
  verificationUrl?: string
  expiresAt?: number
  account?: ChannelAccountView
  error?: string
}

export interface ChannelPairing {
  id: string
  channelAccountId: string
  externalUserId: string
  externalDisplayName: string
  status: ChannelPairingStatus
  requestedAt: number
  expiresAt?: number
  approvedAt?: number
}

export interface ChannelSession {
  channelAccountId: string
  externalChatId: string
  activeConversationId: string
  currentWorkspacePath: string
  createdAt: number
  updatedAt: number
}

export interface ChannelMessageReceipt {
  id: string
  channelAccountId: string
  externalChatId: string
  externalMessageId: string
  direction: ChannelReceiptDirection
  localMessageId?: string
  status: ChannelReceiptStatus
  partIndex?: number
  partCount?: number
  lastError?: string
  createdAt: number
  updatedAt: number
}
