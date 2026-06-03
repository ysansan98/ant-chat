import { Toaster } from '@workspace/ui/components/sonner'
import { Outlet } from 'react-router'
import { AppProviders } from './AppProviders'
import { UpdateNotification } from './components/UpdateNotification'
import { useAppEventListener } from './hooks/useAppEventListener'
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
  useAppEventListener()
  const { updateInfo, showNotification, hideNotification } = useUpdateNotification()

  return (
    <div className="flex h-dvh w-full overflow-hidden">
      {/* Window drag region (Electron) */}
      <div className="app-region-drag absolute top-0 left-0 z-50 h-10 w-full md:h-4" />

      <div className="min-w-0 flex-1">
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
