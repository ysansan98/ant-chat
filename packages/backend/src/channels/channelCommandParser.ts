/* eslint-disable regexp/no-super-linear-backtracking */

export type ChannelCommand
  = | { id: 'new', path?: string }
    | { id: 'model', query: string }
    | { id: 'mode', query?: string }
    | { id: 'models' }
    | { id: 'steer', text: string }
    | { id: 'stop' }
    | { id: 'status' }
    | { id: 'help' }
    | { id: 'approve' }
    | { id: 'deny' }

export type ParsedChannelInput
  = | { kind: 'command', command: ChannelCommand }
    | { kind: 'text', text: string }
    | { kind: 'error', message: string }

const commands = new Set(['new', 'model', 'models', 'mode', 'steer', 'stop', 'status', 'help', 'approve', 'deny'])

export function parseChannelInput(input: string): ParsedChannelInput {
  const text = input.trim()
  if (!text.startsWith('/'))
    return { kind: 'text', text: input }
  const match = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text)
  if (!match || !commands.has(match[1]))
    return { kind: 'error', message: '无法识别频道命令。发送 /help 查看可用命令。' }
  const remainder = match[2]?.trim()
  switch (match[1]) {
    case 'new': return remainder ? { kind: 'command', command: { id: 'new', path: remainder } } : { kind: 'command', command: { id: 'new' } }
    case 'model': return remainder ? { kind: 'command', command: { id: 'model', query: remainder } } : { kind: 'error', message: '用法：/model <名称>' }
    case 'mode': return remainder ? { kind: 'command', command: { id: 'mode', query: remainder } } : { kind: 'command', command: { id: 'mode' } }
    case 'steer': return remainder ? { kind: 'command', command: { id: 'steer', text: remainder } } : { kind: 'error', message: '用法：/steer <文本>' }
    case 'models': return noArgs(match[1], remainder, { id: 'models' })
    case 'stop': return noArgs(match[1], remainder, { id: 'stop' })
    case 'status': return noArgs(match[1], remainder, { id: 'status' })
    case 'help': return noArgs(match[1], remainder, { id: 'help' })
    case 'approve': return noArgs(match[1], remainder, { id: 'approve' })
    case 'deny': return noArgs(match[1], remainder, { id: 'deny' })
  }
  return { kind: 'error', message: '无法识别频道命令。发送 /help 查看可用命令。' }
}

function noArgs(name: string, remainder: string | undefined, command: ChannelCommand): ParsedChannelInput {
  return remainder ? { kind: 'error', message: `用法：/${name}` } : { kind: 'command', command }
}
