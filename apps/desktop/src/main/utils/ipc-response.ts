import type { IpcResponse } from '@ant-chat/shared'
import { createErrorIpcResponse, createIpcResponse } from '@ant-chat/shared'
import { logger } from '@main/utils/logger'

/**
 * 统一 IPC 错误归一化：Error 取 message，其他类型转成 Error 实例。
 * 消除各 domain 里 `error instanceof Error ? error : String(error)` 与 `error as Error` 两套不一致写法。
 */
export function normalizeIpcError(error: unknown): Error {
  if (error instanceof Error) {
    return error
  }
  return new Error(typeof error === 'string' ? error : JSON.stringify(error))
}

/**
 * 包裹 runtime 调用并自动转成 IpcResponse：成功返回 data，失败返回错误响应。
 * 取代每个 IPC 方法里重复的 try { createIpcResponse } catch { createErrorIpcResponse } 样板。
 *
 * @param executor 调用 runtime 的函数，返回业务数据
 * @param errorMessage 错误日志前缀，提供则记 logger.error，不提供则静默
 */
export async function withIpcResponse<T>(
  executor: () => T | Promise<T>,
  errorMessage?: string,
): Promise<IpcResponse<T>> {
  try {
    const data = await executor()
    return createIpcResponse(true, data)
  }
  catch (error) {
    const normalized = normalizeIpcError(error)
    if (errorMessage) {
      logger.error(`${errorMessage}:`, normalized)
    }
    return createErrorIpcResponse(normalized)
  }
}
