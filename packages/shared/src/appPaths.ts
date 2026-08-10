import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

const APP_DIR = '.ant-chat'
const APP_DIR_DEV = '.ant-chat-dev'

export type AppEnvironment = 'development' | 'production'

/**
 * 当前运行环境，来源为环境变量 ANT_CHAT_ENV。
 *
 * 默认 production：桌面打包版与 CLI 未显式配置时，数据与 Keychain 行为保持与旧版一致；
 * 开发入口（pnpm dev / dev:web）通过脚本显式注入 development。
 */
export function getAppEnvironment(): AppEnvironment {
  return process.env.ANT_CHAT_ENV === 'development' ? 'development' : 'production'
}

/**
 * Application data root directory.
 *
 * - production:     ~/.ant-chat
 * - development:    ~/.ant-chat-dev（与生产数据隔离）
 */
export function resolveAppDataRoot(): string {
  return path.join(os.homedir(), getAppEnvironment() === 'development' ? APP_DIR_DEV : APP_DIR)
}

/**
 * Keychain service 名称。
 *
 * macOS Keychain 条目的访问控制绑定"创建它的 app 签名"。dev（无签名 Electron 二进制）
 * 与 prod（打包后的签名应用）是两个不同签名的可执行文件，若共用同一个 service，
 * 互相读写同一批条目会反复触发系统钥匙串授权弹窗。development 因此使用独立 service
 * ant-chat-dev，与生产 ant-chat 隔离。
 */
export function resolveKeychainServiceName(): string {
  return getAppEnvironment() === 'development' ? 'ant-chat-dev' : 'ant-chat'
}
