import type { AgentMode } from '@ant-chat/shared'
import { useChatSttingsStore } from './store'

export function setAgentMode(value: AgentMode) {
  useChatSttingsStore.setState({ agentMode: value })
}
