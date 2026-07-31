import { ArchiveIcon, ArrowLeft, Cable, Crown, Info, MessageCircle, NotebookTabsIcon, Palette, SettingsIcon, ShieldIcon, SparklesIcon } from 'lucide-react'
import { Outlet, useLocation, useNavigate } from 'react-router'
import { ipc, isElectronMacOS, isElectronRuntime } from '@/utils/ipc-bus'

export default function SettingsPage() {
  const navigrate = useNavigate()
  const location = useLocation()
  const activeName = location.pathname.split('/').pop() || 'provider'
  const menus = [
    { id: 'general', name: '通用设置', icon: <SettingsIcon className="size-[1em]" /> },
    { id: 'appearance', name: '外观', icon: <Palette className="size-[1em]" /> },
    { id: 'memory', name: '记忆', icon: <NotebookTabsIcon className="size-[1em]" /> },
    { id: 'permissions', name: '权限', icon: <ShieldIcon className="size-[1em]" /> },
    { id: 'channels', name: '消息频道', icon: <MessageCircle className="size-[1em]" /> },
    { id: 'provider', name: 'AI服务商设置', icon: <Crown className="size-[1em]" /> },
    { id: 'mcp', name: 'MCP设置', icon: <Cable className="size-[1em]" /> },
    { id: 'skills', name: 'Skill设置', icon: <SparklesIcon className="size-[1em]" /> },
    { id: 'archived-conversations', name: '已归档的会话', icon: <ArchiveIcon className="size-[1em]" /> },
    { id: 'about', name: '关于', icon: <Info className="size-[1em]" /> },
  ]

  /**
   * 返回工作区。
   * Web 端同窗口跳转 /chat；桌面端设置窗口通过 IPC 聚焦主窗口并关闭自身。
   */
  // macOS 原生窗口控件（红绿灯）占据顶部空间，需要更大的顶部内边距
  const topPadding = isElectronMacOS() ? 'pt-12' : 'pt-2'

  function backToWorkspace() {
    if (isElectronRuntime()) {
      void ipc.app.focusMainWindow()
      return
    }
    navigrate('/chat')
  }

  return (
    <div className="grid h-(--mainHeight) w-full grid-cols-[max-content_1fr]">
      <div
        data-testid="settings-nav"
        className={`h-full w-50 border-r border-(--border-color) px-2 ${topPadding} pb-2`}
      >
        {/* 返回工作区按钮 */}
        <div className="mb-3">
          <div
            role="button"
            tabIndex={0}
            data-testid="settings-nav-back-workspace"
            className="
              flex h-10 cursor-pointer items-center gap-3 rounded-md px-4
              hover:bg-(--hover-bg-color)
            "
            onClick={backToWorkspace}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                backToWorkspace()
              }
            }}
          >
            <div>
              <ArrowLeft className="size-[1em]" />
            </div>
            <div className="text-sm">
              返回工作区
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          {
            menus.map(item => (
              <div
                key={item.id}
                role="button"
                tabIndex={0}
                data-testid={`settings-nav-${item.id}`}
                className={`
                  flex h-9 cursor-pointer items-center gap-3 rounded-md px-4
                  hover:bg-(--hover-bg-color)
                  ${activeName === item.id ? 'bg-(--hover-bg-color)' : ''}
                `}
                onClick={() => {
                  navigrate(`/settings/${item.id}`)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    navigrate(`/settings/${item.id}`)
                  }
                }}
              >
                <div>
                  {item.icon}
                </div>
                <div className="text-sm">
                  {item.name}
                </div>
              </div>
            ))
          }
        </div>
      </div>
      <div className="overflow-y-auto">
        <Outlet />
      </div>
    </div>
  )
}
