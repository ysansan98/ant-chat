import type { AppPendingMessageSnapshot } from '@ant-chat/shared'
import { toast } from 'sonner'
import agentApi from '@/api/agentApi'
import { useChatSttingsStore } from '@/store/chatSettings'
import { getConversationByIdAction } from '@/store/conversation'
import { addPendingSteeringMessage } from '@/store/messages'
import { submitTurnIntake } from '@/store/turnIntake'
import { useWorkspaceStore } from '@/store/workspace'
import { usePendingMessagesStore } from './store'

/**
 * 队列变更事件与命令响应的统一入口：按 revision 丢弃乱序旧快照。
 *
 * 除首次对账（syncPendingMessages）外，所有投影更新都必须经过这里。
 */
export function applyPendingMessageSnapshot(snapshot: AppPendingMessageSnapshot): void {
  usePendingMessagesStore.getState().applySnapshot(snapshot)
}

/**
 * 连接 / 切换会话时的全量对账。
 *
 * 服务端 revision 可能因进程重启重置，此处强制应用并覆盖本地记录。
 */
export async function syncPendingMessages(conversationId: string): Promise<void> {
  const snapshot = await agentApi.listPendingMessages(conversationId)
  usePendingMessagesStore.getState().applySnapshot(snapshot, { force: true })
}

/** 会话被删除后清理本地投影。 */
export function clearConversationPendingMessages(conversationId: string): void {
  usePendingMessagesStore.getState().clearConversation(conversationId)
}

export async function editPendingMessageAction(conversationId: string, id: string, text: string): Promise<void> {
  const trimmed = text.trim()
  if (!trimmed) {
    await removePendingMessageAction(conversationId, id)
    toast.info('空消息已移除')
    return
  }
  try {
    applyPendingMessageSnapshot(await agentApi.editPendingMessage(conversationId, id, trimmed))
  }
  catch (error) {
    toast.error(error instanceof Error ? error.message : '编辑待处理消息失败')
  }
}

export async function removePendingMessageAction(conversationId: string, id: string): Promise<void> {
  try {
    applyPendingMessageSnapshot(await agentApi.removePendingMessage(conversationId, id))
  }
  catch (error) {
    toast.error(error instanceof Error ? error.message : '删除待处理消息失败')
  }
}

/**
 * 引导：把队列项原子地注入当前任务的下一个迭代。
 * 注入失败时后端保留队列项（D3 回滚语义），此处只提示错误。
 */
export async function steerPendingMessageAction(conversationId: string, id: string): Promise<void> {
  try {
    const result = await agentApi.steerPendingMessage(conversationId, id)
    applyPendingMessageSnapshot(result.snapshot)
    addPendingSteeringMessage(result.message)
  }
  catch (error) {
    toast.error(error instanceof Error ? error.message : '引导失败，消息仍保留在待处理队列')
  }
}

/**
 * 可视化表单提交走普通用户输入路径：任务空闲时立即启动新一轮，
 * 运行中则由后端入队，等任务结束或用户引导。
 */
export async function submitVisualizationFollowUp(conversationId: string, text: string): Promise<void> {
  const trimmed = text.trim()
  if (!trimmed)
    throw new Error('提交内容不能为空')

  const settings = getConversationByIdAction(conversationId)?.settings
  if (!settings)
    throw new Error('当前会话已不存在')
  await submitTurnIntake({
    origin: 'visualization',
    conversationId,
    messageContent: [{ type: 'text', text: trimmed }],
    workspacePath: useWorkspaceStore.getState().currentWorkspacePath,
    settings,
    mode: useChatSttingsStore.getState().agentMode,
  })
}
