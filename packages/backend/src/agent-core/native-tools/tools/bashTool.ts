import type { BashToolInput } from '@ant-chat/shared'
import { preValidateBashScope, runBashTool } from './bashRunner'
import { createNativeTool } from './toolFactory'

export function createBashTool(
  workspacePath: string,
  unrestricted: boolean,
  options: { bashEnvironment?: Record<string, string>, blockAgentBrowser?: boolean, trustedPaths?: string[] } = {},
) {
  return createNativeTool({
    name: 'bash',
    description: '执行 shell 命令',
    inputSchema: {
      type: 'object',
      properties: { command: { type: 'string' }, cwd: { type: 'string' }, timeoutMs: { type: 'number' }, env: { type: 'object' } },
      required: ['command'],
    },
    unrestricted,
    inferScope: input => preValidateBashScope(input as unknown as BashToolInput, workspacePath, options),
    execute: input => runBashTool(input as unknown as BashToolInput, workspacePath, unrestricted, options),
  })
}
