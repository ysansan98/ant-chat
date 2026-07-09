import type { AppRpcInput, AppRpcMethod, AppRpcOutput } from '@ant-chat/shared'
import type { RuntimeCore } from '../createRuntimeCore'
import type { RegisteredRoute } from '../routeRegistry'

/**
 * 类型安全的路由绑定 helper：在构造点校验 method 与 handler 的输入/输出对应关系，
 * 注册时统一退化为 RegisteredRoute（与 RouteRegistry 内部存储一致）。
 */
function route<TMethod extends AppRpcMethod>(
  method: TMethod,
  handler: (input: AppRpcInput<TMethod>) => AppRpcOutput<TMethod> | Promise<AppRpcOutput<TMethod>>,
): RegisteredRoute {
  return { method, handler: handler as RegisteredRoute['handler'] }
}

/**
 * 声明式路由绑定：把 memory / search / files 三类数据访问 RPC 直接绑定到
 * app-data 的 repository/manager，替代逐个手写转发的薄壳模块。
 *
 * 真实实现仍留在 app-data；这里只声明「哪个 RPC 方法落到哪个数据能力」，
 * 让路由表一目了然，新增同类转发只需加一行配置。
 */
export function createDataRoutes(core: Pick<RuntimeCore, 'data'>): RegisteredRoute[] {
  const { memoryManager, messageSearchQuery, messageRepository } = core.data
  return [
    route('memory.getMemoryFiles', () => memoryManager.readMemoryFiles()),
    route('memory.updateMemoryFiles', input => memoryManager.updateMemoryFiles(input.input)),
    route('memory.rollbackSoul', () => memoryManager.rollbackSoul()),
    route('search.searchByKeyword', input => messageSearchQuery.searchMessagesByKeyword(input.query)),
    route('files.getAttachmentData', input => messageRepository.loadAttachmentData(input.fileId)),
  ]
}
