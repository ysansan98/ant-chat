import { Outlet } from 'react-router'
import { AppProviders } from '@/AppProviders'
import { useAppEventListener } from '@/hooks/useAppEventListener'

function SettingsApp() {
  useAppEventListener()

  return (
    <AppProviders>
      <div className="flex h-dvh w-full overflow-hidden">
        <div className="app-region-drag absolute top-0 left-0 z-9999 h-4 w-full"></div>
        <div className="h-dvh min-w-0 flex-1">
          <Outlet />
        </div>
      </div>
    </AppProviders>
  )
}

export default SettingsApp
