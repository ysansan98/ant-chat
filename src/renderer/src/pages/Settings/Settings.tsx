import { Cable, Crown, Info, SettingsIcon, SparklesIcon } from 'lucide-react'
import { Outlet, useLocation, useNavigate } from 'react-router'

export default function SettingsPage() {
  const navigrate = useNavigate()
  const location = useLocation()
  const activeName = location.pathname.split('/').pop() || 'provider'
  const menus = [
    { id: 'general', name: '通用设置', icon: <SettingsIcon className="size-[1em]" /> },
    { id: 'provider', name: 'AI服务商设置', icon: <Crown className="size-[1em]" /> },
    { id: 'mcp', name: 'MCP设置', icon: <Cable className="size-[1em]" /> },
    { id: 'skills', name: 'Skill设置', icon: <SparklesIcon className="size-[1em]" /> },
    { id: 'about', name: '关于', icon: <Info className="size-[1em]" /> },
  ]

  return (
    <div className="grid h-(--mainHeight) w-full grid-cols-[max-content_1fr]">
      <div className="h-full w-50 border-r border-(--border-color) p-2 py-4">
        <div className="flex flex-col gap-3">
          {
            menus.map(item => (
              <div
                key={item.id}
                className={`
                  flex h-10 cursor-pointer items-center gap-3 rounded-md px-4
                  hover:bg-(--hover-bg-color)
                  ${activeName === item.id ? 'bg-(--hover-bg-color)' : ''}
                `}
                onClick={() => {
                  navigrate(`/settings/${item.id}`)
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
      <div>
        <Outlet />
      </div>
    </div>
  )
}
