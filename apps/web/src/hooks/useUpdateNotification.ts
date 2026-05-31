import type { UpdateInfo, UpdateStatus } from '@ant-chat/shared'
import { useEffect, useState } from 'react'
import { getAppEventBus } from '@/api/transports/appEventBus'

export function useUpdateNotification() {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [showNotification, setShowNotification] = useState(false)

  useEffect(() => {
    const eventBus = getAppEventBus()
    const handleUpdateAvailable = (data: { status: UpdateStatus, updateInfo: UpdateInfo | null }) => {
      console.log('收到更新可用通知:', data.updateInfo)
      setUpdateInfo(data.updateInfo)
      setShowNotification(true)
    }

    const handleUpdateNotAvailable = () => {
      setUpdateInfo(null)
      setShowNotification(false)
    }

    const handleUpdateError = (_: unknown, error: any) => {
      console.error('更新检查失败:', error)
      setUpdateInfo(null)
      setShowNotification(false)
    }

    const handleUpdateStatusChanged = (_: unknown, data: { status: UpdateStatus, updateInfo: UpdateInfo | null }) => {
      if (data.status === 'available') {
        handleUpdateAvailable(data)
      }
      else if (data.status === 'not-available') {
        handleUpdateNotAvailable()
      }
    }

    eventBus.on('update:update-status-changed', handleUpdateStatusChanged)
    eventBus.on('update:update-error', handleUpdateError)

    return () => {
      eventBus.removeAllListeners('update:update-status-changed')
      eventBus.removeAllListeners('update:update-error')
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
