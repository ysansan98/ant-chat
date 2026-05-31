import {
  createHashRouter,
  Navigate,
} from 'react-router'
import AntChatApp from '@/App'
import { ChatPage } from '@/pages/Chat'
import { About } from '@/pages/Settings/About'
import { GeneralSettings } from '@/pages/Settings/GeneralSettings'
import MCPManage from '@/pages/Settings/MCPManage'
import { MemorySettings } from '@/pages/Settings/Memory'
import ProviderManage from '@/pages/Settings/ProviderManage'
import SettingsPage from '@/pages/Settings/Settings'
import SkillManage from '@/pages/Settings/SkillManage'
import SettingsApp from '@/SettingsApp'

const windowType = new URLSearchParams(window.location.search).get('window')
const isSettingsWindow = windowType === 'settings'

const settingsRoute = {
  path: 'settings',
  Component: SettingsPage,
  children: [
    { index: true, element: <Navigate to="./general" replace /> },
    { path: 'general', Component: GeneralSettings },
    { path: 'memory', Component: MemorySettings },
    { path: 'provider', Component: ProviderManage },
    { path: 'mcp', Component: MCPManage },
    { path: 'skills', Component: SkillManage },
    { path: 'about', Component: About },
  ],
}

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
            settingsRoute,
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
            settingsRoute,
          ],
        },
      ],
)

export default router
