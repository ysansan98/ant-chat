import { CloseOutlined, MinusOutlined } from '@ant-design/icons'
import { Button } from 'antd'
import { getSystemPlatform, maximizeOrRestoreWindow, minimizeWindow, quitApp } from '@/utils/util'

export function AppBar() {
  return (
    <div className={`
      flex h-(--appBarHeight) shrink-0 items-center justify-between border-b border-(--border-color)
    `}
    >
      <div>
      </div>
      <div className={`
        app-region-drag flex h-full flex-1 items-center justify-center text-center font-medium
      `}
      >
        Ant Chat
      </div>
      <div className="flex items-center gap-1">

        {
          getSystemPlatform() === 'win32'
            ? (
                <>
                  <Button type="text" icon={<MinusOutlined />} onClick={() => minimizeWindow()} />
                  <Button
                    type="text"
                    icon={(
                      <span className="icon-[tdesign--rectangle] flex items-center" />
                    )}
                    onClick={maximizeOrRestoreWindow}
                  />
                  <Button
                    type="text"
                    icon={<CloseOutlined />}
                    onClick={quitApp}
                  />
                </>
              )
            : null
        }
      </div>
    </div>
  )
}
