import type { UpdateInfo, UpdateStatus } from '@ant-chat/shared'
import { useEffect, useState } from 'react'
import { ipc } from '@/utils/ipc-bus'

export function useUpdateNotification() {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [showNotification, setShowNotification] = useState(false)

  useEffect(() => {
    const handleUpdateAvailable = (data: { status: UpdateStatus, updateInfo: UpdateInfo | null }) => {
      console.log('收到更新可用通知:', data.updateInfo)
      setUpdateInfo(data.updateInfo)
      setShowNotification(true)
    }

    const handleUpdateNotAvailable = () => {
      setUpdateInfo(null)
      setShowNotification(false)
    }

    const handleUpdateError = (_: Electron.IpcRendererEvent, error: any) => {
      console.error('更新检查失败:', error)
      setUpdateInfo(null)
      setShowNotification(false)
    }

    const handleUpdateStatusChanged = (_: Electron.IpcRendererEvent, data: { status: UpdateStatus, updateInfo: UpdateInfo | null }) => {
      if (data.status === 'available') {
        handleUpdateAvailable(data)
      }
      else if (data.status === 'not-available') {
        handleUpdateNotAvailable()
      }
    }

    ipc.on('update:update-status-changed', handleUpdateStatusChanged)
    ipc.on('update:update-error', handleUpdateError)

    return () => {
      window.electron.ipcRenderer.removeAllListeners('update:update-status-changed')
      window.electron.ipcRenderer.removeAllListeners('update:update-error')
    }
  }, [])

  const hideNotification = () => {
    setShowNotification(false)
  }

  return {
    updateInfo,
    showNotification,
    hideNotification,
  }
}
