import type { BashToolInput } from '@ant-chat/shared'
import { preValidateBashScope, runBashTool } from '../bashRunner'
import { createNativeTool } from './toolFactory'

export function createBashTool(workspacePath: string, unrestricted: boolean) {
  return createNativeTool({
    name: 'bash',
    unrestricted,
    inferScope: input => preValidateBashScope(input as unknown as BashToolInput, workspacePath),
    execute: input => runBashTool(input as unknown as BashToolInput, workspacePath, unrestricted),
  })
}
