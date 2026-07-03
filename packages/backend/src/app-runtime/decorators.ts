const moduleNames = new WeakMap<object, string>()
const moduleMethods = new WeakMap<object, Map<string, string>>()

export function Module(name: string): ClassDecorator {
  return (target) => {
    moduleNames.set(target, name)
  }
}

export function Method(name?: string): MethodDecorator {
  return (target, propertyKey) => {
    const methods = moduleMethods.get(target) ?? new Map<string, string>()
    methods.set(String(propertyKey), name ?? String(propertyKey))
    moduleMethods.set(target, methods)
  }
}

export function getModuleMetadata(instance: object): { name: string, methods: Map<string, string> } {
  const name = moduleNames.get(instance.constructor)
  if (!name) {
    throw new Error(`运行时模块缺少 @Module 装饰器: ${instance.constructor.name}`)
  }

  return {
    name,
    methods: moduleMethods.get(Object.getPrototypeOf(instance)) ?? new Map(),
  }
}
