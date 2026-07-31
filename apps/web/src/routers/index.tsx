import {
  createHashRouter,
  Navigate,
} from 'react-router'
import AntChatApp from '@/App'
import { ChatLayout } from '@/components/ChatLayout'
import { AutomationsPage } from '@/pages/Automations/Automations'
import { ChatPage } from '@/pages/Chat'
import { About } from '@/pages/Settings/About'
import { AppearanceSettings } from '@/pages/Settings/AppearanceSettings'
import { ArchivedConversations } from '@/pages/Settings/ArchivedConversations'
import { ChannelsPage } from '@/pages/Settings/Channels'
import { GeneralSettings } from '@/pages/Settings/GeneralSettings'
import MCPManage from '@/pages/Settings/MCPManage'
import { MemorySettings } from '@/pages/Settings/Memory'
import { PermissionsPage } from '@/pages/Settings/Permissions'
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
    { path: 'appearance', Component: AppearanceSettings },
    { path: 'memory', Component: MemorySettings },
    { path: 'permissions', Component: PermissionsPage },
    { path: 'channels', Component: ChannelsPage },
    { path: 'provider', Component: ProviderManage },
    { path: 'mcp', Component: MCPManage },
    { path: 'skills', Component: SkillManage },
    { path: 'archived-conversations', Component: ArchivedConversations },
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
              Component: ChatLayout,
              children: [
                { index: true, Component: ChatPage },
                { path: 'automations', Component: AutomationsPage },
              ],
            },
            settingsRoute,
          ],
        },
      ],
)

export default router
