import type { AppRpcInput, AppRpcMethod, AppRpcOutput } from '@ant-chat/shared'
import { getModuleMetadata } from './decorators'

type RpcHandler = (input: unknown) => unknown

/**
 * 声明式路由绑定：不依赖 @Module 类，直接把 RPC 方法映射到 handler。
 * 用于纯转发的数据访问路由，替代逐个手写薄壳模块。
 */
export interface RegisteredRoute {
  method: AppRpcMethod
  handler: RpcHandler
}

export type RuntimeModuleMethods<TNamespace extends string> = {
  [TMethod in AppRpcMethod as TMethod extends `${TNamespace}.${infer TName}` ? TName : never]: (
    input: AppRpcInput<TMethod>,
  ) => AppRpcOutput<TMethod> | Promise<AppRpcOutput<TMethod>>
}

export class RouteRegistry {
  private readonly handlers = new Map<string, RpcHandler>()

  register(instance: object): void {
    const { name, methods } = getModuleMetadata(instance)

    for (const [propertyKey, methodName] of methods) {
      const route = `${name}.${methodName}`
      if (this.handlers.has(route)) {
        throw new Error(`运行时路由重复注册: ${route}`)
      }

      const handler = Reflect.get(instance, propertyKey)
      if (typeof handler !== 'function') {
        throw new TypeError(`运行时路由处理器不是函数: ${route}`)
      }
      this.handlers.set(route, handler.bind(instance) as RpcHandler)
    }
  }

  /** 批量注册声明式路由绑定（用于纯转发的数据访问路由）。 */
  registerRoutes(routes: ReadonlyArray<RegisteredRoute>): void {
    for (const route of routes) {
      if (this.handlers.has(route.method)) {
        throw new Error(`运行时路由重复注册: ${route.method}`)
      }
      this.handlers.set(route.method, route.handler)
    }
  }

  has(method: string): boolean {
    return this.handlers.has(method)
  }

  async invoke<TMethod extends AppRpcMethod>(
    method: TMethod,
    input: AppRpcInput<TMethod>,
  ): Promise<AppRpcOutput<TMethod>> {
    const handler = this.handlers.get(method)
    if (!handler) {
      throw new Error(`运行时路由不存在: ${method}`)
    }
    return await handler(input) as AppRpcOutput<TMethod>
  }
}
