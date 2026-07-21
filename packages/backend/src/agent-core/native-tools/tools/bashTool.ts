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
    description: '执行 shell 命令。调用时用 description 字段简要说明命令用途',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        description: { type: 'string', description: '一句话说明这条命令的目的，例如「安装项目依赖」' },
        cwd: { type: 'string' },
        timeoutMs: { type: 'number' },
        env: { type: 'object' },
      },
      required: ['command'],
    },
    unrestricted,
    inferScope: input => preValidateBashScope(input as unknown as BashToolInput, workspacePath, options),
    execute: input => runBashTool(input as unknown as BashToolInput, workspacePath, unrestricted, options),
  })
}
