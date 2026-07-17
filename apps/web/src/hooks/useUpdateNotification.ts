import type { UpdateInfo, UpdateStatus } from '@ant-chat/shared'
import { useEffect, useState } from 'react'
import { getAppEventSubscriptions } from '@/api/transports/appEventSubscriptions'

export function useUpdateNotification() {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [showNotification, setShowNotification] = useState(false)

  useEffect(() => {
    const eventSubscriptions = getAppEventSubscriptions()
    const handleUpdateAvailable = (data: { status: UpdateStatus, updateInfo: UpdateInfo | null }) => {
      console.log('收到更新可用通知:', data.updateInfo)
      setUpdateInfo(data.updateInfo)
      setShowNotification(true)
    }

    const handleUpdateNotAvailable = () => {
      setUpdateInfo(null)
      setShowNotification(false)
    }

    const handleUpdateError = (error: any) => {
      console.error('更新检查失败:', error)
      setUpdateInfo(null)
      setShowNotification(false)
    }

    const handleUpdateStatusChanged = (data: { status: UpdateStatus, updateInfo: UpdateInfo | null }) => {
      if (data.status === 'available') {
        handleUpdateAvailable(data)
      }
      else if (data.status === 'not-available') {
        handleUpdateNotAvailable()
      }
    }

    const unsubscribeStatus = eventSubscriptions.subscribe('update:update-status-changed', handleUpdateStatusChanged)
    const unsubscribeError = eventSubscriptions.subscribe('update:update-error', handleUpdateError)

    return () => {
      unsubscribeStatus()
      unsubscribeError()
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
