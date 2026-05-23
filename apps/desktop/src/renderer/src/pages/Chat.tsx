import Chat from '@/components/Chat'
import { SearchContainer } from '@/components/Search'
import { ChatSettingsProvider } from '@/contexts/chatSettings'

export function ChatPage() {
  return (
    <div className="relative flex h-(--mainHeight) w-full transition-all">
      <div className="relative flex h-full flex-1">
        <ChatSettingsProvider>
          <Chat />
        </ChatSettingsProvider>
      </div>
      <SearchContainer />
    </div>
  )
}
