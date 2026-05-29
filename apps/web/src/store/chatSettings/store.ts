import type { AgentMode } from '@ant-chat/shared'
import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'

interface ChatSettingsState {
  /** MCP */
  enableMCP: boolean
  /** Agent 权限模式 */
  agentMode: AgentMode
}

interface ChatSettingsActions {
  setEnableMCP: (enableMCP: boolean) => void
  setAgentMode: (agentMode: AgentMode) => void
}

export const useChatSttingsStore = create<ChatSettingsState & ChatSettingsActions>()(
  devtools(
    persist(
      set => ({
        enableMCP: false,
        agentMode: 'hybrid',
        setEnableMCP: enableMCP => set({ enableMCP }),
        setAgentMode: agentMode => set({ agentMode }),
      }),
      { name: 'chat-settings' },
    ),
    { enabled: import.meta.env.MODE === 'development' },
  ),
)
