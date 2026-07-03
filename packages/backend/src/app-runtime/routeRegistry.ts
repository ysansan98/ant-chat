import type { AppRpcInput, AppRpcMethod, AppRpcOutput } from '@ant-chat/shared'
import { getModuleMetadata } from './decorators'

type RpcHandler = (input: unknown) => unknown

export type RuntimeModuleMethods<TNamespace extends string> = {
  [TMethod in AppRpcMethod as TMethod extends `${TNamespace}.${infer TName}` ? TName : never]: (
    input: AppRpcInput<TMethod>,
  ) => AppRpcOutput<TMethod> | Promise<AppRpcOutput<TMethod>>
}

export class RouteRegistry {
  private readonly handlers = new Map<string, RpcHandler>()
  private readonly modules = new Map<object, object>()

  register(instance: object): void {
    this.modules.set(instance.constructor, instance)
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

  getModule<TModule>(moduleType: { prototype: TModule }): TModule {
    const module = this.modules.get(moduleType)
    if (!module) {
      throw new Error(`运行时模块未注册: ${(moduleType as { name?: string }).name ?? 'unknown'}`)
    }
    return module as TModule
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
