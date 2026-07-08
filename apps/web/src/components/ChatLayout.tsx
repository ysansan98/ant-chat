import {
  Sheet,
  SheetContent,
  SheetTitle,
} from '@workspace/ui/components/sheet'
import { MenuIcon, PencilIcon, Search } from 'lucide-react'
import { useState } from 'react'
import { Outlet, useNavigate } from 'react-router'
import { SidebarProvider } from '@/contexts/sidebar'
import { setActiveConversationsId } from '@/store/messages'
import { isElectronMacOS } from '@/utils/ipc-bus'
import { SliderMenu } from './SiliderMenu/SiliderMenu'

/**
 * Chat 工作区布局壳。
 *
 * 侧边栏（会话列表 + 工作区）只随 chat 路由渲染，
 * 这样 settings 作为独立页面时不会被侧边栏挤占空间。
 * 移动端通过顶部按钮 + Sheet 抽屉提供同样的会话访问入口。
 */
export function ChatLayout() {
  const [showSliderMenu, setShowSliderMenu] = useState(true)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const navigate = useNavigate()

  function createNewConversation() {
    navigate('/chat')
    void setActiveConversationsId('')
    setMobileMenuOpen(false)
  }

  function openSearch() {
    window.dispatchEvent(new Event('ant-chat:open-search'))
  }

  return (
    <div className="flex h-dvh w-full overflow-hidden">
      <div
        data-state={showSliderMenu ? 'open' : 'closed'}
        data-testid="desktop-sidebar-shell"
        className="desktop-sidebar-shell hidden shrink-0 overflow-hidden md:block"
      >
        <SliderMenu />
      </div>
      <div className="flex h-dvh min-w-0 flex-1 flex-col">
        {/* 桌面端侧边栏控制 + 快捷入口（保持原有浮动定位） */}
        <div
          className={`
            absolute top-4 z-9990 hidden cursor-pointer items-center gap-2
            md:flex
            ${isElectronMacOS() ? 'left-22.5' : 'left-4'}
          `}
        >
          <span
            role="button"
            tabIndex={0}
            data-testid="desktop-sidebar-trigger"
            aria-label={showSliderMenu ? '收起侧边栏' : '展开侧边栏'}
            className={`
              inline-flex text-xl text-muted-foreground
              hover:text-foreground
              ${
    showSliderMenu
      ? 'icon-[fluent--panel-left-24-filled]'
      : 'icon-[fluent--panel-left-24-regular]'}
            `}
            onClick={() => setShowSliderMenu(prev => !prev)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                setShowSliderMenu(prev => !prev)
              }
            }}
          />

          {/* 侧边栏隐藏时显示快捷入口 */}
          {!showSliderMenu && (
            <>
              <span
                role="button"
                tabIndex={0}
                aria-label="新对话"
                className="inline-flex text-muted-foreground hover:text-foreground"
                onClick={createNewConversation}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    createNewConversation()
                  }
                }}
              >
                <PencilIcon className="size-4.5" />
              </span>
              <span
                role="button"
                tabIndex={0}
                aria-label="搜索"
                className="inline-flex text-muted-foreground hover:text-foreground"
                onClick={openSearch}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    openSearch()
                  }
                }}
              >
                <Search className="size-4.5" />
              </span>
            </>
          )}
        </div>

        {/* 移动端侧边栏触发 */}
        <div className="flex h-13 shrink-0 items-center gap-1 border-b border-border/60 px-4 pt-[env(safe-area-inset-top)] md:hidden">
          <button
            type="button"
            data-testid="mobile-menu-trigger"
            aria-label="打开会话列表"
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => setMobileMenuOpen(true)}
          >
            <MenuIcon />
          </button>
          <button
            type="button"
            aria-label="新建对话"
            className="ml-auto flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={createNewConversation}
          >
            <PencilIcon className="size-4" />
          </button>
        </div>

        <div className="h-full min-h-0 flex-1 overflow-hidden">
          <SidebarProvider value={{ showSliderMenu }}>
            <Outlet />
          </SidebarProvider>
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
    </div>
  )
}
