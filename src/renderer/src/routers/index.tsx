import {
  createHashRouter,
  Navigate,
} from 'react-router'
import AntChatApp from '@/App'
import SettingsApp from '@/pages/Settings/SettingsApp'
import { ChatPage } from '@/pages/Chat'
import { About } from '@/pages/Settings/About'
import { GeneralSettings } from '@/pages/Settings/GeneralSettings'
import MCPManage from '@/pages/Settings/MCPManage'
import ProviderManage from '@/pages/Settings/ProviderManage'
import SettingsPage from '@/pages/Settings/Settings'
import SkillManage from '@/pages/Settings/SkillManage'

// 检测当前是否在设置窗口中（简单方法：可以通过 URL hash 或者后续可以通过更精确的方式）
const isSettingsWindow = window.location.hash.startsWith('#/settings')

const router = createHashRouter(
  isSettingsWindow
    ? [
        {
          path: '/',
          Component: SettingsApp,
          children: [
            {
              index: true,
              element: <Navigate to="/settings" replace />,
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
      ]
    : [
        {
          path: '/',
          Component: AntChatApp,
          children: [
            {
              index: true,
              element: <Navigate to="/chat" replace />,
            },
            {
              path: 'chat',
              Component: ChatPage,
            },
          ],
        },
      ]
)

export default router
