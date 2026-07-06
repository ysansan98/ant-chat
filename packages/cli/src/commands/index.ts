import type { AppControlCommand, AppControlResult } from '@ant-chat/shared'
import type { SocketClient } from '../socket-client'
import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import process from 'node:process'

export interface CliOptions {
  json: boolean
}

/**
 * 执行命令：解析 argv → 构造命令 → 通过 Socket 发送 → 格式化输出
 */
export async function executeCommand(
  client: SocketClient,
  argv: string[],
  options: CliOptions,
): Promise<{ exitCode: number, output?: string, error?: string }> {
  try {
    const command = parseArgv(argv)
    const response = await client.send(command)

    if (!response.ok) {
      const errorMsg = response.error?.message ?? 'Unknown error'
      return { exitCode: 1, output: options.json ? JSON.stringify({ code: 'EXECUTION_ERROR', message: errorMsg }) : `Error: ${errorMsg}` }
    }

    if (response.result === undefined) {
      return { exitCode: 0, output: '' }
    }

    return { exitCode: 0, output: formatResult(command, response.result, options) }
  }
  catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      exitCode: 1,
      error: options.json ? JSON.stringify({ code: 'CLI_ERROR', message }) : message,
    }
  }
}

function parseArgv(argv: string[]): AppControlCommand {
  if (argv.length === 0) {
    throw new Error('Usage: ant-chat <command> [options]\n\nCommands:\n  settings  Manage settings\n  provider  Manage AI providers\n  mcp       Manage MCP servers\n  automation Manage automations')
  }

  const [type, ...rest] = argv

  switch (type) {
    case 'settings':
      return parseSettings(rest)
    case 'provider':
      return parseProvider(rest)
    case 'mcp':
      return parseMcp(rest)
    case 'automation':
      return parseAutomation(rest)
    default:
      throw new Error(`Unknown command: ${type}. Use: settings, provider, mcp, automation`)
  }
}

function parseSettings(args: string[]): AppControlCommand {
  if (args.length === 0)
    throw new Error('Usage: ant-chat settings <show|theme|assistant|proxy> [...]')

  const [sub, ...rest] = args
  switch (sub) {
    case 'show':
      return { type: 'settings', action: 'show' }

    case 'theme': {
      const [action, ...opts] = rest
      if (action !== 'set') {
        throw new Error('Usage: ant-chat settings theme set [--mode <system|light|dark>] [--theme <id>]')
      }
      const parsed = parseNamedArgs(opts)
      const mode = parsed.mode as 'system' | 'light' | 'dark' | undefined
      if (mode && !['system', 'light', 'dark'].includes(mode)) {
        throw new Error('--mode must be system, light, or dark')
      }
      const themeId = parsed.theme
      const lightThemeId = parsed.lightTheme ?? themeId
      const darkThemeId = parsed.darkTheme ?? themeId
      if (!mode && !lightThemeId && !darkThemeId) {
        throw new Error('theme set 至少需要 --mode、--theme、--light-theme 或 --dark-theme')
      }
      return { type: 'settings', action: 'theme:set', mode, lightThemeId, darkThemeId }
    }

    case 'assistant': {
      const [action, ...opts] = rest
      if (action !== 'set')
        throw new Error('Usage: ant-chat settings assistant set --provider <id> --model <id>')
      const parsed = parseNamedArgs(opts)
      if (!parsed.provider) {
        throw new Error('--provider is required')
      }
      if (!parsed.model) {
        throw new Error('--model is required')
      }
      return { type: 'settings', action: 'assistant:set', providerId: parsed.provider as string, modelId: parsed.model as string }
    }

    case 'proxy': {
      const [action, ...opts] = rest
      if (action === 'test') {
        const parsed = parseNamedArgs(opts)
        return { type: 'settings', action: 'proxy:test', url: parsed.url as string | undefined }
      }
      if (action === 'set') {
        const parsed = parseNamedArgs(opts)
        if (!parsed.mode || !['none', 'system', 'manual'].includes(parsed.mode)) {
          throw new Error('--mode is required (none|system|manual)')
        }
        return { type: 'settings', action: 'proxy:set', mode: parsed.mode as 'none' | 'system' | 'manual', url: parsed.url }
      }
      throw new Error('Usage: ant-chat settings proxy <set|test> [options]')
    }

    default:
      throw new Error(`Unknown settings subcommand: ${sub}`)
  }
}

function parseProvider(args: string[]): AppControlCommand {
  if (args.length === 0)
    throw new Error('Usage: ant-chat provider <list|get|create|update|delete|enable|disable|models|key> [...]')

  const [action, ...rest] = args
  switch (action) {
    case 'list':
      return { type: 'provider', action: 'list' }

    case 'get': {
      if (rest.length === 0)
        throw new Error('Usage: ant-chat provider get <id>')
      return { type: 'provider', action: 'get', id: rest[0] }
    }

    case 'create': {
      const parsed = parseNamedArgs(rest)
      if (!parsed.name) {
        throw new Error('--name is required')
      }
      if (!parsed.baseUrl) {
        throw new Error('--base-url is required')
      }
      if (!parsed.apiMode || !['openai', 'anthropic', 'google', 'deepseek'].includes(parsed.apiMode)) {
        throw new Error('--api-mode is required (openai|anthropic|google|deepseek)')
      }
      return {
        type: 'provider',
        action: 'create',
        name: parsed.name as string,
        baseUrl: parsed.baseUrl as string,
        apiMode: parsed.apiMode as 'openai' | 'anthropic' | 'google' | 'deepseek',
        apiKey: parsed.apiKey,
        isOfficial: parsed.isOfficial === 'true',
        isEnabled: parsed.isEnabled !== 'false',
      }
    }

    case 'update': {
      if (rest.length === 0)
        throw new Error('Usage: ant-chat provider update <id> [options]')
      const id = rest[0]
      const parsed = parseNamedArgs(rest.slice(1))
      const apiMode = parseApiMode(parsed.apiMode)
      return {
        type: 'provider',
        action: 'update',
        id,
        name: parsed.name,
        baseUrl: parsed.baseUrl,
        apiMode,
        apiKey: parsed.apiKey,
        isOfficial: parseOptionalBoolean(parsed.isOfficial, '--is-official'),
        isEnabled: parseOptionalBoolean(parsed.isEnabled, '--is-enabled'),
      }
    }

    case 'delete': {
      if (rest.length === 0)
        throw new Error('Usage: ant-chat provider delete <id>')
      return { type: 'provider', action: 'delete', id: rest[0] }
    }

    case 'enable': {
      if (rest.length === 0)
        throw new Error('Usage: ant-chat provider enable <id>')
      return { type: 'provider', action: 'enable', id: rest[0] }
    }

    case 'disable': {
      if (rest.length === 0)
        throw new Error('Usage: ant-chat provider disable <id>')
      return { type: 'provider', action: 'disable', id: rest[0] }
    }

    case 'models': {
      if (rest.length === 0)
        throw new Error('Usage: ant-chat provider models <id>')
      return { type: 'provider', action: 'models', id: rest[0] }
    }

    case 'key': {
      const [keyAction, ...keyRest] = rest
      if (keyAction === 'set') {
        if (keyRest.length === 0) {
          throw new Error('Usage: ant-chat provider key set <id> [--api-key <value>]')
        }
        const id = keyRest[0]
        const parsed = parseNamedArgs(keyRest.slice(1))
        const apiKey = parsed.apiKey ?? readPasswordFromTty('Enter API Key: ')
        return { type: 'provider', action: 'key:set', id, apiKey }
      }
      if (keyAction === 'clear') {
        if (keyRest.length === 0)
          throw new Error('Usage: ant-chat provider key clear <id>')
        return { type: 'provider', action: 'key:clear', id: keyRest[0] }
      }
      throw new Error('Usage: ant-chat provider key <set|clear> <id>')
    }

    default:
      throw new Error(`Unknown provider action: ${action}`)
  }
}

function parseMcp(args: string[]): AppControlCommand {
  if (args.length === 0)
    throw new Error('Usage: ant-chat mcp <list|get|install|edit|delete|start|stop> [...]')

  const [action, ...rest] = args
  switch (action) {
    case 'list':
      return { type: 'mcp', action: 'list' }

    case 'get': {
      if (rest.length === 0)
        throw new Error('Usage: ant-chat mcp get <name>')
      return { type: 'mcp', action: 'get', name: rest[0] }
    }

    case 'install': {
      const parsed = parseNamedArgs(rest)
      const serverName = parsed.name || parsed.serverName
      if (!serverName) {
        throw new Error('--name or --server-name is required')
      }
      const transportType = parsed.transportType ?? 'stdio'
      if (!['stdio', 'sse'].includes(transportType)) {
        throw new Error('--transport-type must be stdio or sse')
      }
      const cmd: AppControlCommand = {
        type: 'mcp',
        action: 'install',
        serverName,
        transportType: transportType as 'stdio' | 'sse',
        command: parsed.command as string | undefined,
        args: parsed.args ? (parsed.args as string).split(' ') : undefined,
        env: parsed.env ? parseKeyValuePairs(parsed.env) : undefined,
        url: parsed.url as string | undefined,
        headers: parsed.headers ? parseKeyValuePairs(parsed.headers) : undefined,
        icon: parsed.icon as string | undefined,
        description: parsed.description as string | undefined,
        timeout: parsed.timeout ? Number(parsed.timeout) : undefined,
      }
      return cmd
    }

    case 'edit': {
      if (rest.length === 0)
        throw new Error('Usage: ant-chat mcp edit <name> [options]')
      const name = rest[0]
      const parsed = parseNamedArgs(rest.slice(1))
      return {
        type: 'mcp',
        action: 'edit',
        serverName: name,
        transportType: parsed.transportType as 'stdio' | 'sse' | undefined,
        command: parsed.command as string | undefined,
        args: parsed.args ? (parsed.args as string).split(' ') : undefined,
        env: parsed.env ? parseKeyValuePairs(parsed.env) : undefined,
        url: parsed.url as string | undefined,
        headers: parsed.headers ? parseKeyValuePairs(parsed.headers) : undefined,
        icon: parsed.icon as string | undefined,
        description: parsed.description as string | undefined,
        timeout: parsed.timeout ? Number(parsed.timeout) : undefined,
      }
    }

    case 'delete': {
      if (rest.length === 0)
        throw new Error('Usage: ant-chat mcp delete <name>')
      return { type: 'mcp', action: 'delete', name: rest[0] }
    }

    case 'start': {
      if (rest.length === 0)
        throw new Error('Usage: ant-chat mcp start <name>')
      return { type: 'mcp', action: 'start', name: rest[0] }
    }

    case 'stop': {
      if (rest.length === 0)
        throw new Error('Usage: ant-chat mcp stop <name>')
      return { type: 'mcp', action: 'stop', name: rest[0] }
    }

    default:
      throw new Error(`Unknown mcp action: ${action}`)
  }
}

function parseAutomation(args: string[]): AppControlCommand {
  if (args.length === 0)
    throw new Error('Usage: ant-chat automation <list|get|runs|create|delete> [...]')

  const [action, ...rest] = args
  switch (action) {
    case 'list':
      return { type: 'automation', action: 'list' }

    case 'get': {
      if (rest.length === 0)
        throw new Error('Usage: ant-chat automation get <id>')
      return { type: 'automation', action: 'get', id: rest[0] }
    }

    case 'runs': {
      return { type: 'automation', action: 'runs', id: rest[0] }
    }

    case 'create': {
      const parsed = parseNamedArgs(rest)
      if (!parsed.name) {
        throw new Error('--name is required')
      }
      if (!parsed.prompt) {
        throw new Error('--prompt is required')
      }
      if (!parsed.workspacePath) {
        throw new Error('--workspace-path is required')
      }
      if (!parsed.providerId) {
        throw new Error('--provider-id is required')
      }
      if (!parsed.modelId) {
        throw new Error('--model-id is required')
      }
      if (parsed.scheduleType !== 'once' && parsed.scheduleType !== 'cron') {
        throw new Error('--schedule-type must be once or cron')
      }
      const schedule = parsed.scheduleType === 'once'
        ? { type: 'once' as const, runAt: parsePositiveNumber(parsed.runAt, '--run-at') }
        : { type: 'cron' as const, expression: (parsed.expression as string) ?? '', timezone: (parsed.timezone as string) ?? 'UTC' }
      return {
        type: 'automation',
        action: 'create',
        name: parsed.name as string,
        prompt: parsed.prompt as string,
        workspacePath: parsed.workspacePath as string,
        providerId: parsed.providerId as string,
        modelId: parsed.modelId as string,
        schedule,
        selectedSkills: parsed.selectedSkills ? (parsed.selectedSkills as string).split(',') : undefined,
        selectedMcpServers: parsed.selectedMcpServers ? (parsed.selectedMcpServers as string).split(',') : undefined,
        enabled: parsed.enabled !== 'false',
      }
    }

    case 'delete': {
      if (rest.length === 0)
        throw new Error('Usage: ant-chat automation delete <id> [--force]')
      const id = rest[0]
      const parsed = parseNamedArgs(rest.slice(1))
      return { type: 'automation', action: 'delete', id, force: parsed.force === 'true' }
    }

    default:
      throw new Error(`Unknown automation action: ${action}`)
  }
}

// ── 输出格式化 ──────────────────────────────────────

function formatResult(command: AppControlCommand, result: AppControlResult, options: CliOptions): string {
  if (options.json) {
    return JSON.stringify(result, null, 2)
  }

  // 人类可读输出
  switch (command.action) {
    case 'show': {
      const r = result as any
      const s = r.settings
      return [
        `Theme: ${s.appearance?.mode ?? 'unknown'}`,
        `Assistant: ${s.assistantProviderId ?? '-'} / ${s.assistantModelId ?? '-'}`,
        `Proxy: ${s.proxySettings?.mode ?? 'none'}`,
      ].join('\n')
    }

    case 'theme:set':
      return `Theme set to: ${(result as any).mode}`

    case 'assistant:set':
      return `Assistant model set to: ${(result as any).providerId}/${(result as any).modelId}`

    case 'proxy:set':
      return `Proxy mode set to: ${(result as any).mode}`

    case 'proxy:test':
      return (result as any).ok ? 'Proxy connection OK' : 'Proxy connection FAILED'

    case 'list': {
      if ('providers' in result) {
        const items = result.providers as Array<{ id: string, name: string, apiMode: string, hasApiKey: boolean, isEnabled: boolean }>
        if (items.length === 0)
          return 'No providers configured.'
        return items.map(p =>
          `${p.id.padEnd(28)} ${p.name.padEnd(20)} ${p.apiMode.padEnd(12)} ${p.hasApiKey ? 'KEY' : '   '} ${p.isEnabled ? 'ENABLED' : 'DISABLED'}`,
        ).join('\n')
      }
      if ('mcpServers' in result) {
        const items = result.mcpServers as Array<{ name: string, status: string, tools?: Array<{ name: string }> }>
        if (items.length === 0)
          return 'No MCP servers configured.'
        return items.map(m =>
          `${m.name.padEnd(24)} ${m.status.padEnd(14)} ${m.tools?.length ?? 0} tools`,
        ).join('\n')
      }
      if ('automations' in result) {
        const items = result.automations as Array<{ id: string, name: string, enabled: boolean, schedule: any }>
        if (items.length === 0)
          return 'No automations configured.'
        return items.map(a =>
          `${a.id.padEnd(28)} ${a.name.padEnd(20)} ${a.enabled ? 'ENABLED ' : 'DISABLED'} ${scheduleSummary(a.schedule)}`,
        ).join('\n')
      }
      return ''
    }

    case 'get': {
      if ('provider' in result) {
        const p = result.provider as any
        return [
          `ID: ${p.id}`,
          `Name: ${p.name}`,
          `Base URL: ${p.baseUrl}`,
          `Mode: ${p.apiMode}`,
          `API Key: ${p.hasApiKey ? '✓ set' : '✗ not set'}`,
          `Enabled: ${p.isEnabled ? 'Yes' : 'No'}`,
        ].join('\n')
      }
      if ('mcpServer' in result) {
        const m = result.mcpServer as any
        return [
          `Name: ${m.name}`,
          `Config: ${m.config}`,
          `Status: ${m.status}`,
          `Tools: ${(m.tools ?? []).map((t: any) => t.name).join(', ') || 'none'}`,
        ].join('\n')
      }
      if ('automation' in result) {
        const a = result.automation as any
        return [
          `ID: ${a.id}`,
          `Name: ${a.name}`,
          `Prompt: ${a.prompt}`,
          `Schedule: ${scheduleSummary(a.schedule)}`,
          `Enabled: ${a.enabled ? 'Yes' : 'No'}`,
        ].join('\n')
      }
      return ''
    }

    case 'create':
    case 'install':
    case 'edit': {
      if ('mcpServer' in result) {
        const m = result.mcpServer as any
        return `MCP server "${m.name}" ${command.action === 'create' ? 'created' : command.action === 'edit' ? 'updated' : 'installed'}. Status: ${m.status}`
      }
      if ('provider' in result) {
        const p = result.provider as any
        return `Provider "${p.name}" (${p.id}) created.`
      }
      if ('automation' in result) {
        const a = result.automation as any
        return `Automation "${a.name}" (${a.id}) created.`
      }
      return 'Done.'
    }

    case 'update':
      return 'Provider updated.'

    case 'delete':
      return 'Deleted successfully.'

    case 'enable':
      return `Provider ${(result as any).id} enabled.`

    case 'disable':
      return `Provider ${(result as any).id} disabled.`

    case 'models': {
      const items = (result as any).models as Array<{ modelId: string, displayName?: string, isEnabled: boolean }>
      if (items.length === 0)
        return 'No models configured.'
      return items.map(m =>
        `${m.modelId.padEnd(28)} ${(m.displayName ?? '-').padEnd(20)} ${m.isEnabled ? 'ENABLED' : 'DISABLED'}`,
      ).join('\n')
    }

    case 'key:set':
      return 'API Key set.'

    case 'key:clear':
      return 'API Key cleared.'

    case 'start':
      return `MCP "${(result as any).name}" started.`

    case 'stop':
      return `MCP "${(result as any).name}" stopped.`

    case 'runs': {
      const items = (result as any).runs as Array<{ id: string, status: string, scheduledAt: number, summary?: string }>
      if (items.length === 0)
        return 'No runs.'
      return items.map(r =>
        `${r.id.padEnd(28)} ${r.status.padEnd(14)} ${r.summary ?? '-'}`,
      ).join('\n')
    }

    default:
      return JSON.stringify(result, null, 2)
  }
}

function scheduleSummary(schedule: any): string {
  if (!schedule)
    return '-'
  if (schedule.type === 'once')
    return `Once at ${new Date(schedule.runAt).toISOString()}`
  if (schedule.type === 'cron')
    return `${schedule.expression} (${schedule.timezone ?? 'UTC'})`
  return '-'
}

// ── 辅助函数 ────────────────────────────────────────

function parseNamedArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const eqIndex = key.indexOf('=')
      if (eqIndex !== -1) {
        result[toCamelCase(key.slice(0, eqIndex))] = key.slice(eqIndex + 1)
      }
      else if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        result[toCamelCase(key)] = args[++i]
      }
      else {
        result[toCamelCase(key)] = 'true'
      }
    }
  }
  return result
}

function toCamelCase(value: string): string {
  return value.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
}

function parsePositiveNumber(value: string | undefined, option: string): number {
  const parsed = Number(value)
  if (!value || !Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${option} must be a positive number`)
  }
  return parsed
}

function parseApiMode(value: string | undefined): 'openai' | 'anthropic' | 'google' | 'deepseek' | undefined {
  if (value === undefined) {
    return undefined
  }
  if (!['openai', 'anthropic', 'google', 'deepseek'].includes(value)) {
    throw new Error('--api-mode must be openai, anthropic, google, or deepseek')
  }
  return value as 'openai' | 'anthropic' | 'google' | 'deepseek'
}

function parseOptionalBoolean(value: string | undefined, option: string): boolean | undefined {
  if (value === undefined) {
    return undefined
  }
  if (value !== 'true' && value !== 'false') {
    throw new Error(`${option} must be true or false`)
  }
  return value === 'true'
}

function parseKeyValuePairs(input: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const part of input.split(',')) {
    const eqIndex = part.indexOf('=')
    if (eqIndex !== -1) {
      result[part.slice(0, eqIndex).trim()] = part.slice(eqIndex + 1).trim()
    }
  }
  return result
}

function readPasswordFromTty(prompt: string): string {
  if (process.platform === 'win32') {
    throw new Error('Windows 请使用 --api-key 显式传入 API Key')
  }
  const fd = fs.openSync('/dev/tty', 'rs+')
  try {
    const result = spawnSync('stty', ['-echo'], { stdio: [fd, 'ignore', fd] })
    if (result.status !== 0) {
      throw new Error('无法关闭终端回显，请使用 --api-key 显式传入 API Key')
    }
    process.stderr.write(prompt)
    let password = ''
    const buffer = Buffer.alloc(1)
    while (fs.readSync(fd, buffer, 0, 1, null) > 0) {
      if (buffer[0] === 10 || buffer[0] === 13) {
        break
      }
      if (buffer[0] === 127 || buffer[0] === 8) {
        // Backspace
        if (password.length > 0) {
          password = password.slice(0, -1)
        }
        continue
      }
      password += buffer.toString('utf-8')
    }
    process.stderr.write('\n')
    return password
  }
  finally {
    spawnSync('stty', ['echo'], { stdio: [fd, 'ignore', fd] })
    fs.closeSync(fd)
  }
}
