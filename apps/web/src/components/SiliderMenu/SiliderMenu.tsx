import { cn } from '@workspace/ui/lib/utils'
import {
  Pencil,
  Repeat2,
  Search,
  Settings,
} from 'lucide-react'
import { useLocation, useNavigate } from 'react-router'
import { useMessagesStore } from '@/store/messages'
import { clearConversationSession } from '@/store/workspaceSession'
import { ipc, isElectronRuntime, unwrapIpcResponse } from '@/utils/ipc-bus'
import { WorkspacePanels } from '../Workspace/WorkspacePanels'
import { SidebarNavItem } from './SliderMenuItem'

interface SliderMenuProps {
  mobile?: boolean
  onNavigate?: () => void
}

export function SliderMenu({ mobile = false, onNavigate }: SliderMenuProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const activeConversationsId = useMessagesStore(state => state.activeConversationsId)
  const isAutomationsPage = location.pathname === '/chat/automations'

  function openSearch() {
    window.dispatchEvent(new Event('ant-chat:open-search'))
    onNavigate?.()
  }

  async function openSettings() {
    if (isElectronRuntime()) {
      void unwrapIpcResponse(await ipc.settings.openSettingsWindow())
      onNavigate?.()
      return
    }

    navigate('/settings')
    onNavigate?.()
  }

  return (
    <aside
      className={cn(
        'flex h-full shrink-0 flex-col text-sm text-sidebar-foreground',
        mobile ? 'w-full' : 'w-(--conversationWidth) py-2 pl-2',
      )}
    >
      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col bg-sidebar px-2 pb-3',
          mobile ? 'rounded-xl pt-10' : 'rounded-2xl pt-8',
        )}
      >
        <div className="flex flex-col gap-1 py-2">
          <SidebarNavItem
            icon={<Pencil className="size-4" />}
            label="新对话"
            dataTestId={mobile ? 'mobile-drawer-new-chat' : 'sidebar-new-chat'}
            active={location.pathname === '/chat' && !activeConversationsId}
            onClick={() => {
              navigate('/chat')
              void clearConversationSession()
              onNavigate?.()
            }}
          />
          <SidebarNavItem
            icon={<Repeat2 className="size-4" />}
            label="自动化"
            dataTestId="sidebar-automations"
            active={isAutomationsPage}
            onClick={() => {
              navigate('/chat/automations')
              onNavigate?.()
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
          <WorkspacePanels onNavigate={onNavigate} />
        </div>

        <div className="mt-3 flex flex-col gap-1">
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
