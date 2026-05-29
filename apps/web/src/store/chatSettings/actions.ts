import type { AgentMode } from '@ant-chat/shared'
import { useChatSttingsStore } from './store'

export function setEnableMCP(value: boolean) {
  useChatSttingsStore.setState({ enableMCP: value })
}

export function setAgentMode(value: AgentMode) {
  useChatSttingsStore.setState({ agentMode: value })
}
