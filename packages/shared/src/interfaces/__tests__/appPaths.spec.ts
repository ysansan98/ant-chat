import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import { getAppEnvironment, resolveAppDataRoot, resolveKeychainServiceName } from '../../appPaths'

const originalEnv = process.env.ANT_CHAT_ENV

afterEach(() => {
  if (originalEnv === undefined)
    delete process.env.ANT_CHAT_ENV
  else
    process.env.ANT_CHAT_ENV = originalEnv
})

describe('getAppEnvironment', () => {
  it('未配置 ANT_CHAT_ENV 时默认 production', () => {
    delete process.env.ANT_CHAT_ENV
    expect(getAppEnvironment()).toBe('production')
  })

  it('设置 ANT_CHAT_ENV=development 后返回 development', () => {
    process.env.ANT_CHAT_ENV = 'development'
    expect(getAppEnvironment()).toBe('development')
  })
})

describe('resolveAppDataRoot', () => {
  it('production 使用 ~/.ant-chat', () => {
    process.env.ANT_CHAT_ENV = 'production'
    expect(resolveAppDataRoot()).toBe(path.join(os.homedir(), '.ant-chat'))
  })

  it('development 使用 ~/.ant-chat-dev，与生产数据隔离', () => {
    process.env.ANT_CHAT_ENV = 'development'
    expect(resolveAppDataRoot()).toBe(path.join(os.homedir(), '.ant-chat-dev'))
  })
})

describe('resolveKeychainServiceName', () => {
  it('production 使用 ant-chat', () => {
    process.env.ANT_CHAT_ENV = 'production'
    expect(resolveKeychainServiceName()).toBe('ant-chat')
  })

  it('development 使用 ant-chat-dev，与生产 Keychain 隔离', () => {
    process.env.ANT_CHAT_ENV = 'development'
    expect(resolveKeychainServiceName()).toBe('ant-chat-dev')
  })
})
