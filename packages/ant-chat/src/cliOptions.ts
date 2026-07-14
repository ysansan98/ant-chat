export interface AntChatCliOptions {
  dataDir?: string
  host: string
  port: number
}

export type AntChatCliAction
  = | { type: 'help' }
    | { type: 'version' }
    | { type: 'start', options: AntChatCliOptions }
    | { type: 'control', argv: string[], options: Pick<AntChatCliOptions, 'dataDir'> }

/** 解析产品级参数；控制命令剩余参数交给 control-client 解析。 */
export function parseCliArgs(args: string[]): AntChatCliAction {
  const remaining: string[] = []
  let dataDir: string | undefined
  let host = '127.0.0.1'
  let port = 3456

  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === '--help' || arg === '-h')
      return { type: 'help' }
    if (arg === '--version' || arg === '-v')
      return { type: 'version' }

    const dataValue = readOptionValue(arg, '--data-dir', args[index + 1])
    if (dataValue) {
      dataDir = dataValue.value
      index += dataValue.consumed
      continue
    }

    const hostValue = readOptionValue(arg, '--host', args[index + 1], true)
    if (hostValue) {
      host = hostValue.value || '0.0.0.0'
      index += hostValue.consumed
      continue
    }

    const portValue = readOptionValue(arg, '--port', args[index + 1])
    if (portValue) {
      port = parsePort(portValue.value)
      index += portValue.consumed
      continue
    }

    remaining.push(arg)
  }

  if (remaining[0] === 'start') {
    return { type: 'start', options: createStartOptions(dataDir, host, port) }
  }

  if (remaining.length > 0) {
    if (!['settings', 'provider', 'mcp', 'automation'].includes(remaining[0])) {
      throw new Error(`未知命令：${remaining[0]}。可用命令：start、settings、provider、mcp、automation`)
    }
    return { type: 'control', argv: remaining, options: { dataDir } }
  }

  return { type: 'start', options: createStartOptions(dataDir, host, port) }
}

function createStartOptions(dataDir: string | undefined, host: string, port: number): AntChatCliOptions {
  return dataDir === undefined ? { host, port } : { dataDir, host, port }
}

function readOptionValue(
  arg: string,
  name: string,
  next: string | undefined,
  allowBare = false,
): { value: string, consumed: number } | undefined {
  if (arg === name) {
    if (next === undefined || next.startsWith('--')) {
      if (allowBare)
        return { value: '', consumed: 0 }
      throw new Error(`${name} 需要一个值`)
    }
    return { value: next, consumed: 1 }
  }
  if (arg.startsWith(`${name}=`)) {
    return { value: arg.slice(name.length + 1), consumed: 0 }
  }
  return undefined
}

function parsePort(value: string): number {
  if (!/^\d+$/.test(value))
    throw new Error(`端口必须是 1 到 65535 之间的整数，收到：${value}`)

  const port = Number(value)
  if (port < 1 || port > 65535)
    throw new Error(`端口必须是 1 到 65535 之间的整数，收到：${value}`)

  return port
}

export const CLI_HELP = `用法：ant-chat [start] [选项]

启动命令：
  ant-chat                 启动本地 Agent Runtime、Web UI、RPC 和 SSE
  ant-chat start           显式启动本地 Agent Runtime

控制命令（只连接已有 Runtime）：
  ant-chat settings ...
  ant-chat provider ...
  ant-chat mcp ...
  ant-chat automation ...

选项：
      --data-dir <路径>   数据目录，默认 ~/.ant-chat，也可用 ANT_CHAT_DATA_ROOT
      --host [地址]       默认监听 127.0.0.1；不带值时监听 0.0.0.0
  -p, --port <端口>       监听端口，默认 3456
  -h, --help              显示帮助
  -v, --version           显示版本

安全提示：--host 开放的是当前没有 HTTP 鉴权的 Web UI、RPC 和 SSE，只允许可信局域网或受控网络使用，禁止直接暴露到公网。
`
