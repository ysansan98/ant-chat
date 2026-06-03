import { ArrowLeft, Cable, Crown, Info, MessageSquare, NotebookTabsIcon, SettingsIcon, SparklesIcon } from 'lucide-react'
import { useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router'
import { isElectronRuntime } from '@/utils/ipc-bus'

const menus = [
  { id: 'general', name: '通用设置', icon: <SettingsIcon className="size-[1em]" /> },
  { id: 'memory', name: '记忆', icon: <NotebookTabsIcon className="size-[1em]" /> },
  { id: 'provider', name: 'AI服务商设置', icon: <Crown className="size-[1em]" /> },
  { id: 'mcp', name: 'MCP设置', icon: <Cable className="size-[1em]" /> },
  { id: 'skills', name: 'Skill设置', icon: <SparklesIcon className="size-[1em]" /> },
  { id: 'about', name: '关于', icon: <Info className="size-[1em]" /> },
]

function SettingsNavMenu({
  activeName,
  onSelect,
}: {
  activeName: string
  onSelect: (id: string) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      {menus.map(item => (
        <div
          key={item.id}
          role="button"
          tabIndex={0}
          data-testid={`settings-nav-${item.id}`}
          className={`
            flex h-10 cursor-pointer items-center gap-3 rounded-md px-4
            hover:bg-(--hover-bg-color)
            ${activeName === item.id ? 'bg-(--hover-bg-color)' : ''}
          `}
          onClick={() => onSelect(item.id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onSelect(item.id)
            }
          }}
        >
          <div>{item.icon}</div>
          <div className="flex-1 text-sm">{item.name}</div>
          <span className="text-xs text-gray-400 md:hidden">›</span>
        </div>
      ))}
    </div>
  )
}

export default function SettingsPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const activeName = location.pathname.split('/').pop() || 'provider'

  // Mobile drill-down: true = show detail, false = show menu list
  const [mobileShowDetail, setMobileShowDetail] = useState(false)

  function handleSelect(id: string) {
    navigate(`/settings/${id}`)
    setMobileShowDetail(true)
  }

  function handleBack() {
    setMobileShowDetail(false)
  }

  const isBrowser = !isElectronRuntime()

  return (
    <div className="flex h-(--mainHeight) w-full flex-col md:flex-row">
      {/* Sidebar: always in DOM, hidden on mobile when viewing detail */}
      <div
        data-testid="settings-nav"
        className={`
          h-full w-full shrink-0 border-r border-(--border-color) px-2 pt-12 pb-4
          md:w-50
          ${mobileShowDetail ? 'hidden md:block' : 'block'}
        `}
      >
        {/* Back to chat button (browser mode only) */}
        {isBrowser && (
          <button
            type="button"
            className={`
              mb-3 flex h-9 w-full items-center gap-2 rounded-md px-4 text-sm font-medium
              text-primary
              hover:bg-(--hover-bg-color)
            `}
            onClick={() => navigate('/chat')}
          >
            <MessageSquare className="size-4" />
            返回对话
          </button>
        )}
        <SettingsNavMenu activeName={activeName} onSelect={handleSelect} />
      </div>

      {/* Content area */}
      <div
        className={`
          min-w-0 flex-1
          ${mobileShowDetail ? 'block' : 'hidden md:block'} overflow-y-auto
        `}
      >
        {/* Mobile back header */}
        <div className="border-b border-(--border-color) px-4 pt-10 pb-3 md:hidden">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="flex items-center gap-1 text-sm text-primary hover:opacity-70"
              onClick={handleBack}
            >
              <ArrowLeft className="size-4" />
              返回
            </button>
            <span className="text-sm font-medium">
              {menus.find(m => m.id === activeName)?.name}
            </span>
          </div>
        </div>
        <Outlet />
      </div>
    </div>
  )
}
