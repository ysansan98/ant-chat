import type { AgentMode } from './agent-runtime'
import { z } from 'zod'

export const ChannelTypeSchema = z.enum(['feishu', 'weixin'])
export type ChannelType = z.infer<typeof ChannelTypeSchema>

/** 频道配置会话的模式：创建新应用，或对已有应用重新扫码授权。 */
export type ChannelSetupMode = 'create' | 'reauth'

/** 出站附件：字节由发送方（transport）解码发送，发送期一次性携带。 */
export interface ChannelAttachment {
  name: string
  mediaType: string
  /** base64 字节。 */
  data: string
  size?: number
  /** 对应消息块的 type：image / document / file。 */
  kind: 'image' | 'document' | 'file'
}

/**
 * agent 工具直接发送附件的宿主能力；channelAccountId + externalChatId
 * 唯一确定目标频道会话，由 ChannelModule 实现并校验连接状态。
 */
export interface ChannelAttachmentSender {
  send: (input: {
    channelAccountId: string
    externalChatId: string
    attachment: ChannelAttachment
  }) => Promise<{ messageId: string }>
}

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
  /** 微信扫码登录的 owner 用户 ID；命中时自动授权，身份不一致回退配对。 */
  ownerUserId?: string
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
  /** 本次配置会话的模式：创建新应用，或对已有应用重新扫码授权。 */
  mode: ChannelSetupMode
  status: 'awaiting_scan' | 'polling' | 'completed' | 'failed' | 'expired'
  verificationUrl?: string
  expiresAt?: number
  account?: ChannelAccountView
  error?: string
  /** 微信扫码登录需要输入手机上显示的验证码。 */
  verifyCodeRequired?: boolean
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
