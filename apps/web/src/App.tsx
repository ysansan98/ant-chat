import { Button } from '@workspace/ui/components/button'
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from '@workspace/ui/components/sheet'
import { Toaster } from '@workspace/ui/components/sonner'
import { MenuIcon, SquarePenIcon } from 'lucide-react'
import { useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router'
import { AppProviders } from './AppProviders'
import { SliderMenu } from './components/SiliderMenu'
import { UpdateNotification } from './components/UpdateNotification'
import { useAppEventListener } from './hooks/useAppEventListener'
import { useUpdateNotification } from './hooks/useUpdateNotification'
import { useConversationsStore } from './store/conversation'
import { setActiveConversationsId, useMessagesStore } from './store/messages'

function AppWrapper() {
  return (
    <AppProviders>
      <AntChatApp />
      <Toaster />
    </AppProviders>
  )
}

function AntChatApp() {
  useAppEventListener()
  const { updateInfo, showNotification, hideNotification } = useUpdateNotification()
  const [showSliderMenu, setShowSliderMenu] = useState(true)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const activeConversationsId = useMessagesStore(state => state.activeConversationsId)
  const currentConversation = useConversationsStore(
    state => state.conversations.find(item => item.id === activeConversationsId),
  )
  const isChatPage = location.pathname.startsWith('/chat')

  function createNewConversation() {
    navigate('/chat')
    void setActiveConversationsId('')
    setMobileMenuOpen(false)
  }

  return (
    <div className="flex h-dvh w-full overflow-hidden">
      <div className="app-region-drag absolute top-0 left-0 z-9999 h-4 w-full"></div>
      <div
        role="button"
        tabIndex={0}
        aria-label={showSliderMenu ? '收起侧边栏' : '展开侧边栏'}
        data-testid="desktop-sidebar-trigger"
        className={`
          absolute top-4 left-22.5 z-9990 hidden cursor-pointer text-muted-foreground
          hover:text-foreground
          md:block
        `}
        onClick={() => {
          setShowSliderMenu(prev => !prev)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setShowSliderMenu(prev => !prev)
          }
        }}
      >
        <span
          className={`
            text-xl
            ${showSliderMenu
      ? 'icon-[fluent--panel-left-24-filled]'
      : 'icon-[fluent--panel-left-24-regular]'}
          `}
        >
        </span>
      </div>
      <div
        data-state={showSliderMenu ? 'open' : 'closed'}
        data-testid="desktop-sidebar-shell"
        className="desktop-sidebar-shell hidden shrink-0 overflow-hidden md:block"
      >
        <SliderMenu />
      </div>
      <div className="flex h-dvh min-w-0 flex-1 flex-col">
        {isChatPage && (
          <header
            className={`
              app-region-no-drag grid h-13 shrink-0 grid-cols-[2.5rem_minmax(0,1fr)_2.5rem]
              items-center border-b border-border/60 bg-background/95 px-2 pt-[env(safe-area-inset-top)]
              supports-backdrop-filter:backdrop-blur-xl
              md:hidden
            `}
          >
            <Button
              type="button"
              variant="ghost"
              size="icon-lg"
              data-testid="mobile-menu-trigger"
              aria-label="打开会话列表"
              onClick={() => setMobileMenuOpen(true)}
            >
              <MenuIcon />
            </Button>
            <div className="min-w-0 px-2 text-center">
              <div className="truncate text-sm font-semibold">
                {currentConversation?.title || '新对话'}
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-lg"
              data-testid="mobile-new-chat"
              aria-label="新建对话"
              onClick={createNewConversation}
            >
              <SquarePenIcon />
            </Button>
          </header>
        )}

        <div className="min-h-0 flex-1">
          <Outlet />
        </div>
      </div>

      <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <SheetContent
          side="left"
          data-testid="mobile-conversation-drawer"
          className="w-[min(20rem,calc(100vw-3rem))] gap-0 p-2 md:hidden"
        >
          <SheetTitle className="sr-only">会话与工作区</SheetTitle>
          <SliderMenu mobile onNavigate={() => setMobileMenuOpen(false)} />
        </SheetContent>
      </Sheet>

      {updateInfo && (
        <UpdateNotification
          updateInfo={updateInfo}
          visible={showNotification}
          onClose={hideNotification}
        />
      )}
    </div>
  )
}

export default AppWrapper
