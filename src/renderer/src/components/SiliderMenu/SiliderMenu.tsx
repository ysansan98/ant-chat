import {
  EditOutlined,
  SearchOutlined,
  SettingOutlined,
} from '@ant-design/icons'
import { useLocation, useNavigate } from 'react-router'
import { setActiveConversationsId } from '@/store/messages'
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

  return (
    <aside className={`
      flex h-full w-(--conversationWidth) shrink-0 flex-col p-2 text-sidebar-foreground
    `}
    >
      <div className="flex min-h-0 flex-1 flex-col rounded-2xl bg-sidebar px-2 pt-8 pb-3">
        <div className="flex flex-col gap-1 py-2">
          <SidebarNavItem
            icon={<EditOutlined />}
            label="新对话"
            active={isChatPage && !location.search}
            onClick={() => {
              navigate('/chat')
              void setActiveConversationsId('')
            }}
          />
          <SidebarNavItem
            icon={<SearchOutlined />}
            label="搜索"
            onClick={openSearch}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          <WorkspacePanels />
        </div>

        <div className="mt-3 flex flex-col gap-1">
          <ThemeMenuItem />
          <SidebarNavItem
            icon={<SettingOutlined />}
            label="设置"
            active={location.pathname.startsWith('/settings')}
            onClick={() => navigate('/settings')}
          />
        </div>
      </div>
    </aside>
  )
}
