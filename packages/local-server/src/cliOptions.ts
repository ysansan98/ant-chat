import { parseArgs } from 'node:util'

export interface LocalServerCliOptions {
  host: '0.0.0.0' | '127.0.0.1'
  port: number
}

export type LocalServerCliAction
  = | { type: 'help' }
    | { type: 'start', options: LocalServerCliOptions }
    | { type: 'version' }

export function parseCliArgs(args: string[]): LocalServerCliAction {
  const { values } = parseArgs({
    args,
    options: {
      help: { type: 'boolean', short: 'h' },
      host: { type: 'boolean' },
      port: { type: 'string', short: 'p', default: '3456' },
      version: { type: 'boolean', short: 'v' },
    },
    strict: true,
  })

  if (values.help)
    return { type: 'help' }

  if (values.version)
    return { type: 'version' }

  return {
    type: 'start',
    options: {
      host: values.host ? '0.0.0.0' : '127.0.0.1',
      port: parsePort(values.port),
    },
  }
}

function parsePort(value: string): number {
  if (!/^\d+$/.test(value))
    throw new Error(`端口必须是 1 到 65535 之间的整数，收到：${value}`)

  const port = Number(value)
  if (port < 1 || port > 65535)
    throw new Error(`端口必须是 1 到 65535 之间的整数，收到：${value}`)

  return port
}

export const CLI_HELP = `用法：ant-chat-local-server [选项]

选项：
  -p, --port <端口>  监听端口，默认 3456
      --host         监听 0.0.0.0，允许通过局域网 IP 访问
  -h, --help         显示帮助
  -v, --version      显示版本
`
