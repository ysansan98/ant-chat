import type { BashToolInput } from '@ant-chat/shared'
import { preValidateBashScope, runBashTool } from '../bashRunner'
import { createNativeTool } from './toolFactory'

export function createBashTool(workspacePath: string, unrestricted: boolean) {
  return createNativeTool({
    name: 'bash',
    description: '执行 shell 命令',
    inputSchema: {
      type: 'object',
      properties: { command: { type: 'string' }, cwd: { type: 'string' }, timeoutMs: { type: 'number' } },
      required: ['command'],
    },
    unrestricted,
    inferScope: input => preValidateBashScope(input as unknown as BashToolInput, workspacePath),
    execute: input => runBashTool(input as unknown as BashToolInput, workspacePath, unrestricted),
    formatError: (error, input) => {
      if (error.includes('AGENT_BASH_COMMAND_BLOCKED')) {
        return `工具 bash 执行失败：命令被安全策略拦截。请仅使用允许的只读命令（如 pwd、ls、cat、rg、find），不要使用重定向、管道、sudo、rm 等。原始命令=${String(input.command || '')}`
      }
      return undefined
    },
  })
}
