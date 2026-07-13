import type { AgentMode } from '@ant-chat/shared'
import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'

interface ChatSettingsState {
  /** Agent 权限模式 */
  agentMode: AgentMode
}

interface ChatSettingsActions {
  setAgentMode: (agentMode: AgentMode) => void
}

export const useChatSttingsStore = create<ChatSettingsState & ChatSettingsActions>()(
  devtools(
    persist(
      set => ({
        agentMode: 'hybrid',
        setAgentMode: agentMode => set({ agentMode }),
      }),
      { name: 'chat-settings' },
    ),
    { enabled: import.meta.env.MODE === 'development' },
  ),
)
