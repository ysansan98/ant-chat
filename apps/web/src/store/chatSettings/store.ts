import type { AgentMode } from '@ant-chat/shared'
import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'

interface ChatSettingsState {
  /** 联网搜索 */
  onlineSearch: boolean
  /** MCP */
  enableMCP: boolean
  /** Agent 权限模式 */
  agentMode: AgentMode
}

interface ChatSettingsActions {
  setOnlineSearch: (onlineSearch: boolean) => void
  setEnableMCP: (enableMCP: boolean) => void
  setAgentMode: (agentMode: AgentMode) => void
}

export const useChatSttingsStore = create<ChatSettingsState & ChatSettingsActions>()(
  devtools(
    persist(
      set => ({
        onlineSearch: false,
        enableMCP: false,
        agentMode: 'hybrid',
        setOnlineSearch: onlineSearch => set({ onlineSearch }),
        setEnableMCP: enableMCP => set({ enableMCP }),
        setAgentMode: agentMode => set({ agentMode }),
      }),
      { name: 'chat-settings' },
    ),
    { enabled: import.meta.env.MODE === 'development' },
  ),
)
