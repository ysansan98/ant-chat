import { Toaster } from '@workspace/ui/components/sonner'
import { useState } from 'react'
import { Outlet } from 'react-router'
import { AppProviders } from './AppProviders'
import { SliderMenu } from './components/SiliderMenu'
import { UpdateNotification } from './components/UpdateNotification'
import { useIpcEventListener } from './hooks/useIpcEventListener'
import { useUpdateNotification } from './hooks/useUpdateNotification'

function AppWrapper() {
  return (
    <AppProviders>
      <AntChatApp />
      <Toaster />
    </AppProviders>
  )
}

function AntChatApp() {
  useIpcEventListener()
  const { updateInfo, showNotification, hideNotification } = useUpdateNotification()
  const [showSliderMenu, setShowSliderMenu] = useState(true)

  return (
    <div className="flex h-dvh w-full overflow-hidden">
      <div className="app-region-drag absolute top-0 left-0 z-9999 h-4 w-full"></div>
      <div
        role="button"
        tabIndex={0}
        className="absolute top-[16px] left-[90px] z-9990 cursor-pointer text-slate-600"
        onClick={() => {
          setShowSliderMenu(prev => !prev)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setShowSliderMenu(prev => !prev)
          }
        }}
      >
        <span className={`
          text-xl
          ${showSliderMenu
      ? 'icon-[fluent--panel-left-24-filled]'
      : `icon-[fluent--panel-left-24-regular]`}
        `}
        >
        </span>
      </div>
      <div
        className={`
          overflow-hidden transition-[width,opacity] duration-300 ease-in-out
          ${showSliderMenu ? 'w-[296px] opacity-100' : 'w-0 opacity-0'}
        `}
      >
        <SliderMenu />
      </div>
      <div className="h-dvh min-w-0 flex-1">
        <Outlet />
      </div>

      {updateInfo && (
        <UpdateNotification
          updateInfo={updateInfo}
          visible={showNotification}
          onClose={hideNotification}
        />
      )}
    </div>
  )
}

export default AppWrapper
