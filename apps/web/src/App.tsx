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

/**
 * 主窗口根壳。
 *
 * 仅承载全局拖拽区、更新通知等与路由无关的壳内容，
 * 不再渲染侧边栏——侧边栏已下沉到 ChatLayout，只随 chat 路由出现。
 * settings 作为独立路由页面，将获得完整宽度。
 */
function AntChatApp() {
  useAppEventListener()
  const { updateInfo, showNotification, hideNotification } = useUpdateNotification()

  return (
    <div className="flex h-dvh w-full overflow-hidden">
      <div className="app-region-drag absolute top-0 left-0 z-9999 h-4 w-full"></div>
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
