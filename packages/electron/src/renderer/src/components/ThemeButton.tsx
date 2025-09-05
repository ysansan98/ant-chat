import { CloudSyncOutlined, MoonFilled, SunFilled } from '@ant-design/icons'
import { Popover } from 'antd'
import { useState } from 'react'
import { useThemeStore } from '@/store/theme'

const options = [
  { id: 'auto' as const, icon: <CloudSyncOutlined />, label: '跟随系统' },
  { id: 'light' as const, icon: <SunFilled />, label: '亮色主题' },
  { id: 'dark' as const, icon: <MoonFilled />, label: '暗黑主题' },
]

function ThemeButton() {
  const { theme, setThemeMode } = useThemeStore()

  const [open, setOpen] = useState(false)

  const hide = () => {
    setOpen(false)
  }

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen)
  }

  const icon = theme === 'light' ? <SunFilled /> : <MoonFilled />

  return (
    <Popover
      content={(
        <div className="flex flex-col gap-2">
          {
            options.map(item => (
              <div
                key={item.id}
                className={`
                  antd-css-var flex cursor-pointer items-center gap-2
                  hover:text-(--ant-color-primary-text-hover)
                `}
                onClick={() => {
                  setThemeMode(item.id)
                  hide()
                }}
              >
                {item.icon}
                {item.label}
              </div>
            ))
          }
        </div>
      )}
      placement="right"
      trigger="click"
      open={open}
      onOpenChange={handleOpenChange}
      zIndex={100}
    >
      <div
        className={`
          flex h-9 w-9 cursor-pointer items-center justify-center rounded-md text-base
          hover:bg-(--hover-bg-color)
        `}
      >
        {icon}
      </div>
    </Popover>
  )
}

export default ThemeButton
