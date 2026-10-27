import type { AppRpcMethod } from '@ant-chat/shared'
import { APP_RPC_METHODS } from '@ant-chat/shared'

const CLIPBOARD_DATA_FIELDS = new Set(['text', 'html', 'image', 'rtf', 'bookmark'])
const CLIPBOARD_TEXT_FIELDS = ['text', 'html', 'rtf', 'bookmark'] as const
const UPDATE_CONFIG_FIELDS = new Set([
  'autoCheck',
  'autoDownload',
  'checkInterval',
  'includePrerelease',
  'lastCheckTime',
  'skippedVersion',
])
const UPDATE_CHECK_INTERVALS = new Set(['startup', 'daily', 'weekly'])
const CLIPBOARD_TYPES = new Set(['selection', 'clipboard'])

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

export function isAppRpcMethod(method: unknown): method is AppRpcMethod {
  return typeof method === 'string' && Object.hasOwn(APP_RPC_METHODS, method)
}

/** 返回错误消息；`null` 表示通过。 */
export function validateRuntimeCallInput(input: unknown): string | null {
  if (input === undefined)
    return null
  if (!isPlainRecord(input))
    return 'runtime.call 的 input 必须是对象或 undefined'
  return null
}

/** 返回错误消息；`null` 表示通过。 */
export function validateClipboardWrite(data: unknown, type: unknown): string | null {
  if (type !== undefined && (typeof type !== 'string' || !CLIPBOARD_TYPES.has(type)))
    return 'clipboardWrite 的 type 只能是 selection、clipboard 或 undefined'
  if (!isPlainRecord(data))
    return 'clipboardWrite 的 data 必须是对象'

  for (const key of Object.keys(data)) {
    if (!CLIPBOARD_DATA_FIELDS.has(key))
      return `clipboardWrite 的 data 包含未知字段: ${key}`
  }

  for (const key of CLIPBOARD_TEXT_FIELDS) {
    const value = data[key]
    if (value !== undefined && typeof value !== 'string')
      return `clipboardWrite 的 data.${key} 必须是字符串`
  }

  if (data.image !== undefined && !isPlainRecord(data.image))
    return 'clipboardWrite 的 data.image 必须是对象'

  return null
}

/** 返回错误消息；`null` 表示通过。 */
export function validateUpdateConfig(config: unknown): string | null {
  if (!isPlainRecord(config))
    return 'setUpdateConfig 的 config 必须是对象'

  for (const key of Object.keys(config)) {
    if (!UPDATE_CONFIG_FIELDS.has(key))
      return `setUpdateConfig 的 config 包含未知字段: ${key}`
  }

  for (const key of ['autoCheck', 'autoDownload', 'includePrerelease'] as const) {
    if (typeof config[key] !== 'boolean')
      return `setUpdateConfig 的 config.${key} 必须是布尔值`
  }

  if (typeof config.checkInterval !== 'string' || !UPDATE_CHECK_INTERVALS.has(config.checkInterval))
    return 'setUpdateConfig 的 config.checkInterval 必须是 startup、daily 或 weekly'

  if (typeof config.lastCheckTime !== 'number' || !Number.isFinite(config.lastCheckTime) || config.lastCheckTime < 0)
    return 'setUpdateConfig 的 config.lastCheckTime 必须是非负有限数字'

  if (config.skippedVersion !== undefined && typeof config.skippedVersion !== 'string')
    return 'setUpdateConfig 的 config.skippedVersion 必须是字符串'

  return null
}
