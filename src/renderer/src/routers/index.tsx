import {
  createHashRouter,
  Navigate,
} from 'react-router'
import AntChatApp from '@/App'
import { ChatPage } from '@/pages/Chat'
import { About } from '@/pages/Settings/About'
import { GeneralSettings } from '@/pages/Settings/GeneralSettings'
import MCPManage from '@/pages/Settings/MCPManage'
import ProviderManage from '@/pages/Settings/ProviderManage'
import SettingsPage from '@/pages/Settings/Settings'
import SkillManage from '@/pages/Settings/SkillManage'

const router = createHashRouter([
  {
    path: '/',
    Component: AntChatApp,
    children: [
      {
        index: true, // 代表 / 路径
        element: <Navigate to="/chat" replace />,
      },
      {
        path: 'chat',
        Component: ChatPage,
      },
      {
        path: 'settings',
        Component: SettingsPage,
        children: [
          { index: true, element: <Navigate to="./general" replace /> },
          { path: 'general', Component: GeneralSettings },
          { path: 'provider', Component: ProviderManage },
          { path: 'mcp', Component: MCPManage },
          { path: 'skills', Component: SkillManage },
          { path: 'about', Component: About },
        ],
      },
    ],
  },

])

export default router
