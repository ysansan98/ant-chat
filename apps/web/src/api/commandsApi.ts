import type { RunBuiltinCommandParams, RunBuiltinCommandResult } from '@ant-chat/shared'
import { getAppTransport } from './transports/appTransport'

async function runBuiltinCommand(params: RunBuiltinCommandParams): Promise<RunBuiltinCommandResult> {
  return (await getAppTransport()).commands.runBuiltinCommand(params)
}

export default {
  runBuiltinCommand,
}
