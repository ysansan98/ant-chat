import { GithubFilled, MessageOutlined, SettingOutlined } from '@ant-design/icons'

import { useLocation, useNavigate } from 'react-router'
import ThemeButton from '../ThemeButton'
import { SliderMenuItem } from './SliderMenuItem'

export function SliderMenu() {
  const location = useLocation()
  const navigate = useNavigate()

  function handleNavigate(e: React.MouseEvent, path: string) {
    e.preventDefault()
    navigate(path)
  }

  return (
    <div className="h-full w-12.5 border-r-1 border-(--border-color)">
      <div className="flex h-full flex-col items-center justify-between">
        <div className="flex flex-col items-center gap-5 pt-2">
          <div className="flex h-8 w-8 items-center justify-center p-1">
            <img
              src="./logo.svg"
              className="h-full w-full cursor-pointer"
              draggable={false}
              onClick={() => {
                navigate('/')
              }}
            />
          </div>

          <SliderMenuItem
            title="对话"
            icon={<MessageOutlined />}
            path="/chat"
            actived={location.pathname.includes('/chat')}
            onClick={handleNavigate}
          />

          <SliderMenuItem
            title="设置"
            icon={<SettingOutlined />}
            path="/settings"
            actived={location.pathname.startsWith('/settings')}
            onClick={handleNavigate}
          />
        </div>
        <div className="flex flex-col items-center gap-2 pb-4">
          <ThemeButton />

          <SliderMenuItem
            title={null}
            icon={<GithubFilled />}
            path="https://github.com/whitexie/ant-chat"
            onClick={(_, path) => {
              window.location.href = path
            }}
          />
        </div>
      </div>
    </div>
  )
}
