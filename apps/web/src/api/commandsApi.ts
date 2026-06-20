import type { RunBuiltinCommandParams, RunBuiltinCommandResult } from '@ant-chat/shared'
import { getAppRpcClient } from './transports/appRpc'

async function runBuiltinCommand(params: RunBuiltinCommandParams): Promise<RunBuiltinCommandResult> {
  return getAppRpcClient().call('commands.runBuiltinCommand', params)
}

async function cancelCommand(conversationId: string): Promise<null> {
  return getAppRpcClient().call('commands.cancelCommand', { conversationId })
}

export default {
  runBuiltinCommand,
  cancelCommand,
}
