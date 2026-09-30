import type { AgentMode, AgentTurnSource, AppPendingMessage, AppPendingMessageSnapshot, AppPendingMessageSource, ILogger, IMessage } from '@ant-chat/shared'
import type { PendingMessageRecord, PendingMessageRepository } from '../data'
import { nanoid } from 'nanoid'

/**
 * 待处理消息队列：任务运行中提交的消息在服务端暂存，任务终态后接力发出。
 *
 * 本服务拥有「存储 + 快照广播」；接力启动（startTurn）由 AgentTurnService 消费
 * listRecords / remove 完成，避免队列服务反向依赖 turn 服务。引导（steer）
 * 需要注入当前任务，通过注入的 injectSteering 端口调用 runtime。
 */
export interface PendingMessageServiceDeps {
  repository: PendingMessageRepository
  /** 注入当前任务的下一个迭代；无运行任务时抛错，调用方保留队列项（D3 回滚语义）。 */
  injectSteering: (conversationId: string, text: string) => Promise<IMessage>
  /** 广播会话级队列快照；所有变更（入队/编辑/删除/引导出队/接力/回滚）都必须广播。 */
  emitUpdated: (snapshot: AppPendingMessageSnapshot) => void
  logger?: ILogger
}

export interface EnqueuePendingMessageInput {
  conversationId: string
  text: string
  source: AppPendingMessageSource
  mode?: AgentMode
  /** 频道场景入队前已持久化的 user message，接力时复用。 */
  userMessageId?: string
  turnSource?: AgentTurnSource
}

export interface PendingMessageService {
  listRecords: (conversationId: string) => Promise<PendingMessageRecord[]>
  snapshot: (conversationId: string) => Promise<AppPendingMessageSnapshot>
  enqueue: (input: EnqueuePendingMessageInput) => Promise<AppPendingMessageSnapshot>
  edit: (conversationId: string, id: string, text: string) => Promise<AppPendingMessageSnapshot>
  remove: (conversationId: string, id: string) => Promise<AppPendingMessageSnapshot>
  /** 原子「出队 + 注入」：注入成功才出队；注入失败时记录保留在队列。 */
  steer: (conversationId: string, id: string) => Promise<{ message: IMessage, snapshot: AppPendingMessageSnapshot }>
}

export function createPendingMessageService(deps: PendingMessageServiceDeps): PendingMessageService {
  const { repository, injectSteering, emitUpdated, logger } = deps
  // 会话级快照版本号：进程内单调递增，客户端据此丢弃乱序旧快照。
  const revisions = new Map<string, number>()

  /** 读取当前记录并组装会话级快照；revision 由调用方决定（snapshot 用现值，broadcast 先递增）。 */
  async function buildSnapshot(conversationId: string, revision: number): Promise<AppPendingMessageSnapshot> {
    const records = await repository.listByConversation(conversationId)
    return {
      conversationId,
      revision,
      messages: records.map(toPublicMessage),
    }
  }

  async function snapshot(conversationId: string): Promise<AppPendingMessageSnapshot> {
    return await buildSnapshot(conversationId, revisions.get(conversationId) ?? 0)
  }

  async function broadcast(conversationId: string): Promise<AppPendingMessageSnapshot> {
    const revision = (revisions.get(conversationId) ?? 0) + 1
    revisions.set(conversationId, revision)
    const current = await buildSnapshot(conversationId, revision)
    emitUpdated(current)
    return current
  }

  return {
    listRecords: conversationId => repository.listByConversation(conversationId),
    snapshot,
    async enqueue(input) {
      const text = input.text.trim()
      if (!text)
        throw new Error('待处理消息内容不能为空')
      const createdAt = await nextCreatedAt(repository, input.conversationId)
      await repository.create({
        id: `pending-${nanoid()}`,
        conversationId: input.conversationId,
        text,
        source: input.source,
        ...(input.mode ? { mode: input.mode } : {}),
        ...(input.userMessageId ? { userMessageId: input.userMessageId } : {}),
        ...(input.turnSource ? { turnSource: input.turnSource } : {}),
        createdAt,
      })
      return await broadcast(input.conversationId)
    },
    async edit(conversationId, id, text) {
      const trimmed = text.trim()
      if (!trimmed)
        throw new Error('待处理消息内容不能为空')
      const updated = await repository.updateText(conversationId, id, trimmed)
      if (!updated)
        throw new Error('待处理消息不存在')
      return await broadcast(conversationId)
    },
    async remove(conversationId, id) {
      await repository.delete(conversationId, id)
      return await broadcast(conversationId)
    },
    async steer(conversationId, id) {
      const record = await repository.get(conversationId, id)
      if (!record)
        throw new Error('待处理消息不存在')
      // 注入失败（如任务已结束）直接抛错，记录保留在队列由用户决定重试或删除。
      const message = await injectSteering(conversationId, record.text)
      // 注入已发生，删除失败只记录：极低概率下会留下重复项，由用户手动清理。
      await repository.delete(conversationId, id).catch((error) => {
        logger?.warn('引导注入成功但队列项删除失败', { conversationId, id, error })
        return false
      })
      const current = await broadcast(conversationId)
      return { message, snapshot: current }
    },
  }
}

async function nextCreatedAt(
  repository: PendingMessageRepository,
  conversationId: string,
): Promise<number> {
  const records = await repository.listByConversation(conversationId)
  const last = records.reduce((max, record) => Math.max(max, record.createdAt), 0)
  return Math.max(Date.now(), last + 1)
}

function toPublicMessage(record: PendingMessageRecord): AppPendingMessage {
  return {
    id: record.id,
    conversationId: record.conversationId,
    text: record.text,
    source: record.source,
    createdAt: record.createdAt,
  }
}
