import { AddMcpConfigSchema } from '@ant-chat/shared'

interface ServerJson {
  mcpServers: {
    [key: string]: {
      transportType?: 'streamable-http' | 'stdio'
      command?: string
      args?: string[]
      env?: Record<string, string | number | boolean>
      url?: string
    }
  }
}

/**
 * 按 POSIX shell 词法拆分命令行（支持单引号、双引号、反斜杠转义）。
 *
 * Claude Desktop 等工具允许把完整命令行写在 command 字段（如
 * `npx -y pkg <url>`），而本产品 stdio 配置要求 command 只填可执行文件、
 * 其余参数放 args。快速导入时需要用该函数拆分，否则 spawn 会把整串当
 * 可执行文件名，必然 ENOENT。
 */
export function splitCommandLine(commandLine: string): { command: string, args: string[] } {
  const tokens: string[] = []
  let current = ''
  let quote: '\'' | '"' | null = null

  for (let i = 0; i < commandLine.length; i++) {
    const ch = commandLine[i]
    if (quote === '\'') {
      if (ch === '\'')
        quote = null
      else
        current += ch
    }
    else if (quote === '"') {
      if (ch === '"') {
        quote = null
      }
      else if (ch === '\\' && (commandLine[i + 1] === '"' || commandLine[i + 1] === '\\' || commandLine[i + 1] === '$' || commandLine[i + 1] === '`')) {
        current += commandLine[++i]
      }
      else {
        current += ch
      }
    }
    else if (ch === '\'' || ch === '"') {
      quote = ch
    }
    else if (ch === '\\') {
      current += commandLine[++i] ?? '\\'
    }
    else if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current)
        current = ''
      }
    }
    else {
      current += ch
    }
  }

  if (quote) {
    // 未闭合引号属于格式错误：明确报错，避免静默地把整串塞进 command 掩盖问题。
    throw new Error(`command 中的引号未闭合：${commandLine}`)
  }

  if (current)
    tokens.push(current)

  if (tokens.length === 0)
    return { command: commandLine, args: [] }

  return { command: tokens[0], args: tokens.slice(1) }
}

export function parseMcpServerJsonText(text: string): AddMcpConfigSchema {
  const data = JSON.parse(text) as ServerJson
  if (typeof data.mcpServers !== 'object') {
    throw new TypeError('mcpServers 格式错误')
  }
  const entries = Object.entries(data.mcpServers)

  if (entries.length === 0) {
    throw new Error('mcpServers 为空')
  }

  const [serverName, config] = entries[0]

  const options = { ...config, serverName, transportType: 'stdio' }

  if (config.url) {
    options.transportType = 'streamable-http'
  }

  // 兼容 Claude Desktop 的整串 command 格式：拆成可执行文件 + 参数。
  // 用户显式提供 args 时保留用户语义，避免覆盖。
  if (options.transportType === 'stdio' && config.command && !config.args?.length) {
    const parsed = splitCommandLine(config.command)
    options.command = parsed.command
    options.args = parsed.args
  }

  return AddMcpConfigSchema.parse(options)
}
