import type { AgentObservabilityEvidence, AgentTurnSummary, AgentTurnTimeline } from '@ant-chat/shared'
import { getAppRpcClient } from './transports/appRpc'

export const observabilityApi = {
  listTurns: (conversationId: string): Promise<AgentTurnSummary[]> =>
    getAppRpcClient().call('agent.listTurns', { conversationId }),
  getTurnTimeline: (conversationId: string, turnId: string): Promise<AgentTurnTimeline | null> =>
    getAppRpcClient().call('agent.getTurnTimeline', { conversationId, turnId }),
  getEvidence: (conversationId: string, turnId: string, recordId: string): Promise<AgentObservabilityEvidence | null> =>
    getAppRpcClient().call('agent.getEvidence', { conversationId, turnId, recordId }),
  clearAll: (): Promise<null> =>
    getAppRpcClient().call('agent.clearAllObservability', undefined),
}
