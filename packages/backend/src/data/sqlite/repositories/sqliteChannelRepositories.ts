/* eslint-disable style/max-statements-per-line */

import type { ChannelAccount, ChannelMessageReceipt, ChannelPairing, ChannelReceiptDirection, ChannelReceiptStatus, ChannelSession, ChannelType } from '@ant-chat/shared'
import type { ChannelAccountRepository, ChannelPairingRepository, ChannelReceiptRepository, ChannelSessionRepository } from '../../repositories/channelRepository'
import type { AppDataDatabase } from '../types'
import { nanoid } from 'nanoid'

export class SqliteChannelAccountRepository implements ChannelAccountRepository {
  constructor(private readonly db: AppDataDatabase) {}
  async list() { return (this.db.prepare('SELECT * FROM channel_accounts ORDER BY created_at').all() as AccountRow[]).map(row => mapAccount(row)) }
  async getById(id: string) { return mapAccount(this.db.prepare('SELECT * FROM channel_accounts WHERE id = ?').get(id) as AccountRow | undefined, id) }
  async getByType(type: ChannelType) { const row = this.db.prepare('SELECT * FROM channel_accounts WHERE channel_type = ?').get(type) as AccountRow | undefined; return row ? mapAccount(row) : undefined }
  async upsert(account: ChannelAccount) {
    this.db.prepare(`INSERT INTO channel_accounts (id, channel_type, display_name, credential_ref, default_workspace_path, permission_mode, enabled, status, last_error, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET channel_type=excluded.channel_type, display_name=excluded.display_name, credential_ref=excluded.credential_ref,
      default_workspace_path=excluded.default_workspace_path, permission_mode=excluded.permission_mode, enabled=excluded.enabled, status=excluded.status, last_error=excluded.last_error, updated_at=excluded.updated_at`).run(
      account.id,
      account.channelType,
      account.displayName,
      account.credentialRef,
      account.defaultWorkspacePath,
      account.permissionMode,
      account.enabled ? 1 : 0,
      account.status,
      account.lastError ?? null,
      account.createdAt,
      account.updatedAt,
    )
    return this.getById(account.id)
  }

  async updateStatus(id: string, status: ChannelAccount['status'], lastError?: string) { this.db.prepare('UPDATE channel_accounts SET status = ?, last_error = ?, updated_at = ? WHERE id = ?').run(status, lastError ?? null, Date.now(), id); return this.getById(id) }
  async updateEnabled(id: string, enabled: boolean) { this.db.prepare('UPDATE channel_accounts SET enabled = ?, updated_at = ? WHERE id = ?').run(enabled ? 1 : 0, Date.now(), id); return this.getById(id) }
  async updatePermissionMode(id: string, permissionMode: ChannelAccount['permissionMode']) { this.db.prepare('UPDATE channel_accounts SET permission_mode = ?, updated_at = ? WHERE id = ?').run(permissionMode, Date.now(), id); return this.getById(id) }
  async delete(id: string) { this.db.prepare('DELETE FROM channel_accounts WHERE id = ?').run(id) }
}

export class SqliteChannelPairingRepository implements ChannelPairingRepository {
  constructor(private readonly db: AppDataDatabase) {}
  async get(accountId: string, userId: string) { const row = this.db.prepare('SELECT * FROM channel_pairings WHERE channel_account_id = ? AND external_user_id = ?').get(accountId, userId) as PairingRow | undefined; return row ? mapPairing(row) : undefined }
  async listPending(accountId: string) { return (this.db.prepare('SELECT * FROM channel_pairings WHERE channel_account_id = ? AND status = \'pending\' ORDER BY requested_at').all(accountId) as PairingRow[]).map(mapPairing) }
  async upsert(pairing: ChannelPairing) {
    this.db.prepare(`INSERT INTO channel_pairings (id, channel_account_id, external_user_id, external_display_name, status, requested_at, expires_at, approved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(channel_account_id, external_user_id) DO UPDATE SET external_display_name=excluded.external_display_name, status=excluded.status, expires_at=excluded.expires_at, approved_at=excluded.approved_at`).run(pairing.id, pairing.channelAccountId, pairing.externalUserId, pairing.externalDisplayName, pairing.status, pairing.requestedAt, pairing.expiresAt ?? null, pairing.approvedAt ?? null); return (await this.get(pairing.channelAccountId, pairing.externalUserId))!
  }

  async updateStatus(id: string, status: ChannelPairing['status'], approvedAt?: number) { this.db.prepare('UPDATE channel_pairings SET status = ?, approved_at = ? WHERE id = ?').run(status, approvedAt ?? null, id); const row = this.db.prepare('SELECT * FROM channel_pairings WHERE id = ?').get(id) as PairingRow; return mapPairing(row) }
}

export class SqliteChannelSessionRepository implements ChannelSessionRepository {
  constructor(private readonly db: AppDataDatabase) {}
  async get(accountId: string, chatId: string) { const row = this.db.prepare('SELECT * FROM channel_sessions WHERE channel_account_id = ? AND external_chat_id = ?').get(accountId, chatId) as SessionRow | undefined; return row ? mapSession(row) : undefined }
  async upsert(session: ChannelSession) {
    this.db.prepare(`INSERT INTO channel_sessions (channel_account_id, external_chat_id, active_conversation_id, current_workspace_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(channel_account_id, external_chat_id) DO UPDATE SET active_conversation_id=excluded.active_conversation_id, current_workspace_path=excluded.current_workspace_path, updated_at=excluded.updated_at`).run(session.channelAccountId, session.externalChatId, session.activeConversationId, session.currentWorkspacePath, session.createdAt, session.updatedAt); return (await this.get(session.channelAccountId, session.externalChatId))!
  }
}

export class SqliteChannelReceiptRepository implements ChannelReceiptRepository {
  constructor(private readonly db: AppDataDatabase) {}
  async get(accountId: string, messageId: string, direction: ChannelReceiptDirection, partIndex?: number) { const row = this.db.prepare('SELECT * FROM channel_message_receipts WHERE channel_account_id = ? AND external_message_id = ? AND direction = ? AND part_index IS ?').get(accountId, messageId, direction, partIndex ?? null) as ReceiptRow | undefined; return row ? mapReceipt(row) : undefined }
  async getOutboundByLocalMessageId(accountId: string, localMessageId: string) { const row = this.db.prepare('SELECT * FROM channel_message_receipts WHERE channel_account_id = ? AND local_message_id = ? AND direction = \'outbound\' ORDER BY created_at DESC LIMIT 1').get(accountId, localMessageId) as ReceiptRow | undefined; return row ? mapReceipt(row) : undefined }
  async create(input: Omit<ChannelMessageReceipt, 'id' | 'createdAt' | 'updatedAt'>) { const now = Date.now(); const id = `receipt-${nanoid()}`; this.db.prepare(`INSERT INTO channel_message_receipts (id, channel_account_id, external_chat_id, external_message_id, direction, local_message_id, status, part_index, part_count, last_error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, input.channelAccountId, input.externalChatId, input.externalMessageId, input.direction, input.localMessageId ?? null, input.status, input.partIndex ?? null, input.partCount ?? null, input.lastError ?? null, now, now); return (await this.get(input.channelAccountId, input.externalMessageId, input.direction, input.partIndex))! }
  async updateStatus(id: string, status: ChannelReceiptStatus, lastError?: string, localMessageId?: string) { this.db.prepare('UPDATE channel_message_receipts SET status = ?, last_error = ?, local_message_id = COALESCE(?, local_message_id), updated_at = ? WHERE id = ?').run(status, lastError ?? null, localMessageId ?? null, Date.now(), id); return mapReceipt(this.db.prepare('SELECT * FROM channel_message_receipts WHERE id = ?').get(id) as ReceiptRow) }
}

interface AccountRow { id: string, channel_type: ChannelType, display_name: string, credential_ref: string, default_workspace_path: string | null, permission_mode: ChannelAccount['permissionMode'], enabled: number, status: ChannelAccount['status'], last_error: string | null, created_at: number, updated_at: number }
interface PairingRow { id: string, channel_account_id: string, external_user_id: string, external_display_name: string, status: ChannelPairing['status'], requested_at: number, expires_at: number | null, approved_at: number | null }
interface SessionRow { channel_account_id: string, external_chat_id: string, active_conversation_id: string, current_workspace_path: string, created_at: number, updated_at: number }
interface ReceiptRow { id: string, channel_account_id: string, external_chat_id: string, external_message_id: string, direction: ChannelReceiptDirection, local_message_id: string | null, status: ChannelReceiptStatus, part_index: number | null, part_count: number | null, last_error: string | null, created_at: number, updated_at: number }
function mapAccount(row: AccountRow | undefined, id = ''): ChannelAccount {
  if (!row)
    throw new Error(`${id} 不存在`); return { id: row.id, channelType: row.channel_type, displayName: row.display_name, credentialRef: row.credential_ref, defaultWorkspacePath: row.default_workspace_path, permissionMode: row.permission_mode, enabled: row.enabled === 1, status: row.status, lastError: row.last_error ?? undefined, createdAt: row.created_at, updatedAt: row.updated_at }
}
function mapPairing(row: PairingRow): ChannelPairing { return { id: row.id, channelAccountId: row.channel_account_id, externalUserId: row.external_user_id, externalDisplayName: row.external_display_name, status: row.status, requestedAt: row.requested_at, expiresAt: row.expires_at ?? undefined, approvedAt: row.approved_at ?? undefined } }
function mapSession(row: SessionRow): ChannelSession { return { channelAccountId: row.channel_account_id, externalChatId: row.external_chat_id, activeConversationId: row.active_conversation_id, currentWorkspacePath: row.current_workspace_path, createdAt: row.created_at, updatedAt: row.updated_at } }
function mapReceipt(row: ReceiptRow): ChannelMessageReceipt { return { id: row.id, channelAccountId: row.channel_account_id, externalChatId: row.external_chat_id, externalMessageId: row.external_message_id, direction: row.direction, localMessageId: row.local_message_id ?? undefined, status: row.status, partIndex: row.part_index ?? undefined, partCount: row.part_count ?? undefined, lastError: row.last_error ?? undefined, createdAt: row.created_at, updatedAt: row.updated_at } }
