import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'

interface ChatSettingsState {
  /** 联网搜索 */
  onlineSearch: boolean
  /** MCP */
  enableMCP: boolean
}

interface ChatSettingsActions {
  setOnlineSearch: (onlineSearch: boolean) => void
  setEnableMCP: (enableMCP: boolean) => void
}

export const useChatSttingsStore = create<ChatSettingsState & ChatSettingsActions>()(
  devtools(
    persist(
      set => ({
        onlineSearch: false,
        enableMCP: false,
        setOnlineSearch: onlineSearch => set({ onlineSearch }),
        setEnableMCP: enableMCP => set({ enableMCP }),
      }),
      { name: 'chat-settings' },
    ),
    { enabled: import.meta.env.MODE === 'development' },
  ),
)
