import { Button } from '@workspace/ui/components/button'
import { Minus, X } from 'lucide-react'
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
                  <Button variant="ghost" size="icon-sm" onClick={() => minimizeWindow()}>
                    <Minus />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={maximizeOrRestoreWindow}
                  >
                    <span className="icon-[tdesign--rectangle] flex items-center" />
                  </Button>
                  <Button variant="ghost" size="icon-sm" onClick={quitApp}>
                    <X />
                  </Button>
                </>
              )
            : null
        }
      </div>
    </div>
  )
}
