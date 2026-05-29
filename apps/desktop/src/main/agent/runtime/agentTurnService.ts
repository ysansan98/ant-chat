import type { AgentRuntime } from '@ant-chat/agent-core'
import type { AgentTurnResult, StartAgentTurnOptions } from '@ant-chat/shared'
import { getAgentRuntimeEnvironment } from './agentRuntimeEnvironment'

export const agentRuntime = new Proxy({} as AgentRuntime, {
  get(_, prop) {
    return (getAgentRuntimeEnvironment().runtime as any)[prop]
  },
})

export async function startAgentTurn(options: StartAgentTurnOptions): Promise<AgentTurnResult> {
  return await getAgentRuntimeEnvironment().agentService.startTurn(options)
}
