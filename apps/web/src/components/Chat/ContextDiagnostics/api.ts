import type { ContextTraceItemDetail, ListContextTraceInput, ListContextTraceOutput } from '@ant-chat/shared'
import { getAppRpcClient } from '@/api/transports/appRpc'

const rpc = getAppRpcClient()

/** 分页拉取上下文追踪列表 */
export async function listContextTrace(
  input: ListContextTraceInput,
): Promise<ListContextTraceOutput> {
  return rpc.call('agent.listContextTrace', input)
}

/** 获取单个追踪项的完整详情（含所有 ContextItem 快照） */
export async function getContextTraceItem(
  conversationId: string,
  requestId: string,
): Promise<ContextTraceItemDetail | null> {
  return rpc.call('agent.getContextTraceItem', { conversationId, requestId, itemId: '' })
}
