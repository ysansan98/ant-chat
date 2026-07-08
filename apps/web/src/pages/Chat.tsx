import Chat from '@/components/Chat'
import { SearchContainer } from '@/components/Search'
import { ChatSettingsProvider } from '@/contexts/chatSettings'

export function ChatPage() {
  return (
    <div className="relative flex size-full min-w-0 transition-all">
      <div className="relative flex min-w-0 flex-1">
        <ChatSettingsProvider>
          <Chat />
        </ChatSettingsProvider>
      </div>
      <SearchContainer />
    </div>
  )
}
