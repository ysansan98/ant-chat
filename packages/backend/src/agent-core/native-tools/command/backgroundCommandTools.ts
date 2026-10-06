import type { AgentTool } from '@ant-chat/shared'
import type { BackgroundCommandManager } from './backgroundCommandManager'
import { createNativeTool } from '../tools/toolFactory'

export interface BackgroundCommandToolsOptions {
  manager: BackgroundCommandManager
  conversationId: string
}

const READ_INPUT_SCHEMA = {
  type: 'object' as const,
  properties: {
    commandId: { type: 'string', description: 'execute_command(runInBackground) 返回的后台命令 id。' },
    offset: { type: 'number', description: '上次返回的 nextOffset（字节）；省略时从头读。' },
    maxChars: { type: 'number', description: '单次返回上限（字节），默认 65536，最大 262144。' },
    waitMs: { type: 'number', description: '有界等待：等到有新输出、进程退出或超时；默认 0，最大 30000。' },
  },
  required: ['commandId'],
}

const KILL_INPUT_SCHEMA = {
  type: 'object' as const,
  properties: {
    commandId: { type: 'string', description: '要终止的后台命令 id。' },
    signal: { type: 'string', enum: ['SIGTERM', 'SIGKILL'], description: '默认 SIGTERM；SIGKILL 用于无响应进程。' },
  },
  required: ['commandId'],
}

const LIST_INPUT_SCHEMA = {
  type: 'object' as const,
  properties: {},
  required: [] as string[],
}

export function createBackgroundCommandTools(options: BackgroundCommandToolsOptions): AgentTool[] {
  const { manager, conversationId } = options
  return [
    createReadCommandOutputTool(manager, conversationId),
    createKillCommandTool(manager, conversationId),
    createListCommandsTool(manager, conversationId),
  ]
}

function createReadCommandOutputTool(manager: BackgroundCommandManager, conversationId: string): AgentTool {
  return createNativeTool({
    name: 'read_command_output',
    description: [
      '读取某个后台命令的增量输出。返回本次文本与 nextOffset；下次把 nextOffset 作为 offset 传入即可只读新增内容。',
      'waitMs 大于 0 时最多阻塞该毫秒数，用于等待新日志（如编译进度）。',
      'status 为 exited/killed 时表示进程已结束，仍可继续读到日志末尾。',
      '日志触及 20MB 上限后 truncated=true，之后不再增长。',
    ].join('\n'),
    inputSchema: READ_INPUT_SCHEMA,
    operationType: 'command_read',
    unrestricted: true,
    inferScope: input => resolveCommandScope(manager, conversationId, input),
    validateInput: input => validateReadInput(input),
    async execute(input) {
      const commandId = String(input.commandId ?? '').trim()
      try {
        const result = await manager.read(conversationId, commandId, {
          offset: typeof input.offset === 'number' ? input.offset : undefined,
          maxChars: typeof input.maxChars === 'number' ? input.maxChars : undefined,
          waitMs: typeof input.waitMs === 'number' ? input.waitMs : undefined,
          // agent 读到终态即视为已知晓，避免随后再收到同一条结束通知
          consumeNotices: true,
        })
        const header = [
          `commandId=${commandId}`,
          `status=${result.status}`,
          result.exitCode === undefined ? '' : `exitCode=${result.exitCode}`,
          `offset=${result.offset}`,
          `nextOffset=${result.nextOffset}`,
          `truncated=${result.truncated}`,
        ].filter(Boolean).join(' ')
        const body = result.text || '(暂无新输出)'
        return {
          ok: true,
          result: `${header}\n${body}`,
          diagnostics: {
            commandId,
            status: result.status,
            exitCode: result.exitCode,
            offset: result.offset,
            nextOffset: result.nextOffset,
            truncated: result.truncated,
          },
        }
      }
      catch (error) {
        return { ok: false, result: error instanceof Error ? error.message : '读取后台命令输出失败' }
      }
    },
  })
}

function createKillCommandTool(manager: BackgroundCommandManager, conversationId: string): AgentTool {
  return createNativeTool({
    name: 'kill_command',
    description: [
      '终止本会话启动的后台命令（整个进程组）。默认 SIGTERM，宽限后自动补 SIGKILL；无响应进程可直接传 SIGKILL。',
      '只能终止当前会话的后台命令；返回终止后的 status 与 exitCode。',
      '若命令不是本会话启动的，返回失败且不泄露其是否存在。',
    ].join('\n'),
    inputSchema: KILL_INPUT_SCHEMA,
    operationType: 'command',
    unrestricted: true,
    inferScope: input => resolveCommandScope(manager, conversationId, input),
    validateInput: (input) => {
      if (typeof input.commandId !== 'string' || !input.commandId.trim())
        return 'commandId 必须是非空字符串'
      if (input.signal !== undefined && input.signal !== 'SIGTERM' && input.signal !== 'SIGKILL')
        return 'signal 必须是 SIGTERM 或 SIGKILL'
      return null
    },
    async execute(input) {
      const commandId = String(input.commandId ?? '').trim()
      const signal = input.signal === 'SIGKILL' ? 'SIGKILL' : 'SIGTERM'
      try {
        // agent 自己发起的终止不回队通知，避免把工具返回与结束通知重复喂给模型
        const summary = await manager.kill(conversationId, commandId, signal, 'agent')
        if (!summary)
          return { ok: false, result: `后台命令不存在或不属于当前会话：${commandId}` }
        return {
          ok: summary.status !== 'running',
          result: [
            `commandId=${summary.commandId} status=${summary.status}`,
            summary.exitCode === undefined ? '' : `exitCode=${summary.exitCode}`,
          ].filter(Boolean).join(' '),
          diagnostics: {
            commandId: summary.commandId,
            status: summary.status,
            exitCode: summary.exitCode,
          },
        }
      }
      catch (error) {
        return { ok: false, result: error instanceof Error ? error.message : '终止后台命令失败' }
      }
    },
  })
}

function createListCommandsTool(manager: BackgroundCommandManager, conversationId: string): AgentTool {
  return createNativeTool({
    name: 'list_commands',
    description: [
      '列出当前会话的全部后台命令（含已结束的），用于恢复上下文或确认 commandId。',
      '返回 commandId、状态、pid、退出码、启动时间、是否持有 Turn 密钥与日志路径。',
    ].join('\n'),
    inputSchema: LIST_INPUT_SCHEMA,
    operationType: 'command_read',
    unrestricted: true,
    inferScope: () => 'workspace',
    async execute() {
      const commands = manager.list(conversationId)
      if (commands.length === 0)
        return { ok: true, result: '当前会话没有后台命令。' }
      return { ok: true, result: JSON.stringify(commands, null, 2) }
    },
  })
}

function resolveCommandScope(
  manager: BackgroundCommandManager,
  conversationId: string,
  input: Record<string, unknown>,
): 'workspace' | 'outside' | 'blocked' {
  const commandId = typeof input.commandId === 'string' ? input.commandId.trim() : ''
  if (!commandId)
    return 'blocked'
  return manager.scopeOf(conversationId, commandId) ?? 'blocked'
}

function validateReadInput(input: Record<string, unknown>): string | null {
  if (typeof input.commandId !== 'string' || !input.commandId.trim())
    return 'commandId 必须是非空字符串'
  if (input.offset !== undefined && !isNonNegativeNumber(input.offset))
    return 'offset 必须是非负数'
  if (input.maxChars !== undefined && !isPositiveNumber(input.maxChars))
    return 'maxChars 必须是正数'
  if (input.waitMs !== undefined && !isNonNegativeNumber(input.waitMs))
    return 'waitMs 必须是非负数'
  return null
}

function isNonNegativeNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isPositiveNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}
