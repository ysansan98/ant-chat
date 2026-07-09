import type { AppRpcInput } from '@ant-chat/shared'
import { describe, expect, it } from 'vitest'
import { Method, Module } from '../decorators'
import { RouteRegistry } from '../routeRegistry'

@Module('settings')
class SettingsModule {
  @Method()
  getSettings(_input: AppRpcInput<'settings.getSettings'>) {
    return { theme: 'system' as const }
  }
}

describe('routeRegistry', () => {
  it('组合模块名和方法名生成路由并保持 this 绑定', async () => {
    const registry = new RouteRegistry()
    const settings = new SettingsModule()
    registry.register(settings)

    await expect(registry.invoke('settings.getSettings', undefined)).resolves.toEqual({ theme: 'system' })
    expect(registry.getModule(SettingsModule)).toBe(settings)
  })

  it('拒绝重复注册相同路由', () => {
    const registry = new RouteRegistry()
    registry.register(new SettingsModule())

    expect(() => registry.register(new SettingsModule())).toThrow('运行时路由重复注册: settings.getSettings')
  })

  it('调用未注册路由时返回明确错误', async () => {
    const registry = new RouteRegistry()

    await expect(registry.invoke('settings.getSettings', undefined)).rejects.toThrow('运行时路由不存在: settings.getSettings')
  })

  it('registerRoutes 声明式绑定路由并拒绝重复', async () => {
    const registry = new RouteRegistry()
    registry.registerRoutes([
      { method: 'settings.getSettings', handler: () => ({ theme: 'dark' }) },
    ])

    await expect(registry.invoke('settings.getSettings', undefined)).resolves.toEqual({ theme: 'dark' })

    expect(() => registry.registerRoutes([
      { method: 'settings.getSettings', handler: () => null },
    ])).toThrow('运行时路由重复注册: settings.getSettings')
  })
})
