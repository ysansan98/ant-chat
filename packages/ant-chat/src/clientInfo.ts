import type { ClientInfo } from '@ant-chat/backend'

/**
 * 构建期由 tsdown define 注入产品版本；tsx 直接运行 src 时该标识不存在，
 * 通过 typeof 保护回退为 dev，避免 ReferenceError。
 */
declare const __ANT_CHAT_VERSION__: string

export const clientInfo: ClientInfo = {
  name: 'ant-chat',
  version: typeof __ANT_CHAT_VERSION__ === 'string' ? __ANT_CHAT_VERSION__ : 'dev',
}
