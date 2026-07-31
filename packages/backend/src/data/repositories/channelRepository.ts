import type { AgentMode, ChannelAccount, ChannelMessageReceipt, ChannelPairing, ChannelReceiptDirection, ChannelReceiptStatus, ChannelSession, ChannelType } from '@ant-chat/shared'

export interface ChannelAccountRepository {
  list: () => Promise<ChannelAccount[]>
  getById: (id: string) => Promise<ChannelAccount>
  getByType: (type: ChannelType) => Promise<ChannelAccount | undefined>
  upsert: (account: ChannelAccount) => Promise<ChannelAccount>
  updateStatus: (id: string, status: ChannelAccount['status'], lastError?: string) => Promise<ChannelAccount>
  updateEnabled: (id: string, enabled: boolean) => Promise<ChannelAccount>
  updatePermissionMode: (id: string, permissionMode: AgentMode) => Promise<ChannelAccount>
  delete: (id: string) => Promise<void>
}

export interface ChannelPairingRepository {
  get: (channelAccountId: string, externalUserId: string) => Promise<ChannelPairing | undefined>
  listPending: (channelAccountId: string) => Promise<ChannelPairing[]>
  upsert: (pairing: ChannelPairing) => Promise<ChannelPairing>
  updateStatus: (id: string, status: ChannelPairing['status'], approvedAt?: number) => Promise<ChannelPairing>
}

export interface ChannelSessionRepository {
  get: (channelAccountId: string, externalChatId: string) => Promise<ChannelSession | undefined>
  upsert: (session: ChannelSession) => Promise<ChannelSession>
}

export interface ChannelReceiptRepository {
  get: (channelAccountId: string, externalMessageId: string, direction: ChannelReceiptDirection, partIndex?: number) => Promise<ChannelMessageReceipt | undefined>
  getOutboundByLocalMessageId: (channelAccountId: string, localMessageId: string) => Promise<ChannelMessageReceipt | undefined>
  create: (input: Omit<ChannelMessageReceipt, 'id' | 'createdAt' | 'updatedAt'>) => Promise<ChannelMessageReceipt>
  updateStatus: (id: string, status: ChannelReceiptStatus, lastError?: string, localMessageId?: string) => Promise<ChannelMessageReceipt>
}
