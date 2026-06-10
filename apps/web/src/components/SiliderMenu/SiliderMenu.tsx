import {
  Pencil,
  Search,
  Settings,
} from 'lucide-react'
import { useLocation, useNavigate } from 'react-router'
import { setActiveConversationsId } from '@/store/messages'
import { ipc, isElectronRuntime, unwrapIpcResponse } from '@/utils/ipc-bus'
import { ThemeMenuItem } from '../ThemeButton'
import { WorkspacePanels } from '../Workspace/WorkspacePanels'
import { SidebarNavItem } from './SliderMenuItem'

export function SliderMenu() {
  const location = useLocation()
  const navigate = useNavigate()
  const isChatPage = location.pathname.includes('/chat')

  function openSearch() {
    window.dispatchEvent(new Event('ant-chat:open-search'))
  }

  async function openSettings() {
    if (isElectronRuntime()) {
      void unwrapIpcResponse(await ipc.settings.openSettingsWindow())
      return
    }

    navigate('/settings')
  }

  return (
    <aside className={`
      flex h-full w-(--conversationWidth) shrink-0 flex-col p-2 text-sidebar-foreground text-sm
    `}
    >
      <div className="flex min-h-0 flex-1 flex-col rounded-2xl bg-sidebar px-2 pt-8 pb-3">
        <div className="flex flex-col gap-1 py-2">
          <SidebarNavItem
            icon={<Pencil className="size-4" />}
            label="新对话"
            dataTestId="sidebar-new-chat"
            active={isChatPage && !location.search}
            onClick={() => {
              navigate('/chat')
              void setActiveConversationsId('')
            }}
          />
          <SidebarNavItem
            icon={<Search className="size-4" />}
            label="搜索"
            dataTestId="sidebar-search"
            onClick={openSearch}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          <WorkspacePanels />
        </div>

        <div className="mt-3 flex flex-col gap-1">
          <ThemeMenuItem />
          <SidebarNavItem
            icon={<Settings className="size-4" />}
            label="设置"
            dataTestId="sidebar-settings"
            active={location.pathname.startsWith('/settings')}
            onClick={openSettings}
          />
        </div>
      </div>
    </aside>
  )
}
