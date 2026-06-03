import { Menu, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import Chat from '@/components/Chat'
import { SearchContainer } from '@/components/Search'
import { SliderMenu } from '@/components/SiliderMenu'
import { ChatSettingsProvider } from '@/contexts/chatSettings'
import { useIsMobile } from '@/hooks/useIsMobile'
import { isElectronRuntime } from '@/utils/ipc-bus'

export function ChatPage() {
  const isMobile = useIsMobile()
  // Desktop: sidebar collapsed state
  const [desktopCollapsed, setDesktopCollapsed] = useState(false)
  // Mobile: drawer open state
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false)

  return (
    <div className="relative flex h-(--mainHeight) w-full">

      {/* ── Mobile: hamburger button ── */}
      <button
        type="button"
        className={`
          app-region-no-drag absolute top-2 left-2 z-60 flex size-10 items-center justify-center
          rounded-full text-foreground
          hover:bg-black/5
          md:hidden
          dark:hover:bg-white/10
        `}
        onClick={() => setMobileDrawerOpen(prev => !prev)}
      >
        <Menu className="size-5" />
      </button>

      {/* ── Mobile: drawer backdrop ── */}
      <AnimatePresence>
        {mobileDrawerOpen && isMobile && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-90 bg-black/30 backdrop-blur-sm"
            onClick={() => setMobileDrawerOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* ── Mobile: drawer sidebar ── */}
      <AnimatePresence>
        {mobileDrawerOpen && isMobile && (
          <motion.aside
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'tween', duration: 0.28 }}
            className="fixed inset-y-0 left-0 z-100 w-(--conversationWidth) pt-10"
            onClick={() => setMobileDrawerOpen(false)}
          >
            <SliderMenu />
          </motion.aside>
        )}
      </AnimatePresence>

      {/* ── Desktop: single toggle button (stays fixed, sidebar animates behind it) ── */}
      <button
        type="button"
        className={`
          ${isElectronRuntime() ? 'left-21' : 'left-3'}
          app-region-no-drag absolute top-3 z-60 hidden size-7 items-center justify-center
          rounded-md text-slate-500
          hover:bg-black/5 hover:text-slate-700
          md:flex
          dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-slate-200
        `}
        onClick={() => setDesktopCollapsed(prev => !prev)}
      >
        {desktopCollapsed
          ? <PanelLeftOpen className="size-4" />
          : <PanelLeftClose className="size-4" />}
      </button>

      {/* ── Desktop: inline sidebar ── */}
      <div
        className={`
          hidden h-full shrink-0 overflow-hidden transition-[width] duration-300 ease-in-out
          md:block
          ${desktopCollapsed ? 'w-0' : 'w-(--conversationWidth)'}
        `}
      >
        <SliderMenu />
      </div>

      {/* ── Main content ── */}
      <div className="relative flex h-full min-w-0 flex-1 pt-12 transition-all md:pt-0">
        <div className="relative flex h-full flex-1">
          <ChatSettingsProvider>
            <Chat />
          </ChatSettingsProvider>
        </div>
        <SearchContainer />
      </div>
    </div>
  )
}
