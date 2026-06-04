import type { RunBuiltinCommandParams, RunBuiltinCommandResult } from '@ant-chat/shared'
import { getAppTransport } from './transports/appTransport'

async function runBuiltinCommand(params: RunBuiltinCommandParams): Promise<RunBuiltinCommandResult> {
  return (await getAppTransport()).commands.runBuiltinCommand(params)
}

async function cancelCommand(conversationId: string): Promise<null> {
  return (await getAppTransport()).commands.cancelCommand(conversationId)
}

export default {
  runBuiltinCommand,
  cancelCommand,
}
