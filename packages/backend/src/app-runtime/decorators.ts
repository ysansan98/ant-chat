const RPC_METHOD = Symbol('rpcMethod')
const moduleNames = new WeakMap<object, string>()

export function Module(name: string): ClassDecorator {
  return (target) => {
    moduleNames.set(target, name)
  }
}

export function Method(name?: string): MethodDecorator {
  return (target, contextOrKey) => {
    // esbuild (TC39):  target = 方法函数, contextOrKey = { kind, name, ... }
    // tsc (legacy):    target = prototype,  contextOrKey = propertyKey(string)
    const key = typeof contextOrKey === 'object' ? (contextOrKey as { name: string }).name : contextOrKey
    const rpcName = name ?? String(key)

    const fn = typeof target === 'function'
      ? target // TC39: target 就是函数本身
      : typeof key === 'string' ? (target as any)[key] : undefined // Legacy: 从 prototype 上取函数
    if (fn && typeof fn === 'function') {
      ;(fn as any)[RPC_METHOD] = rpcName
    }
  }
}

export function getModuleMetadata(instance: object): { name: string, methods: Map<string, string> } {
  const name = moduleNames.get(instance.constructor)
  if (!name) {
    throw new Error(`运行时模块缺少 @Module 装饰器: ${instance.constructor.name}`)
  }

  const methods = new Map<string, string>()
  const proto = Object.getPrototypeOf(instance)
  for (const key of Object.getOwnPropertyNames(proto)) {
    if (key === 'constructor')
      continue
    const desc = Object.getOwnPropertyDescriptor(proto, key)
    if (desc?.value && typeof desc.value === 'function') {
      const rpcName = (desc.value as any)[RPC_METHOD]
      if (rpcName) {
        methods.set(key, rpcName)
      }
    }
  }

  return { name, methods }
}
