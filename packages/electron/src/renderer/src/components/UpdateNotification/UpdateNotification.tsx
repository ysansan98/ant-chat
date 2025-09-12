import type { ProgressInfo, UpdateInfo } from '@ant-chat/shared'
import { DownloadOutlined, ExclamationCircleOutlined } from '@ant-design/icons'
import { App, Button, Modal, Progress, Space, Typography } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { updateApi } from '@/api/updateApi'
import RenderMarkdown from '@/components/RenderMarkdown'
import { ipc } from '@/utils/ipc-bus'

const { Title, Text } = Typography

export interface UpdateNotificationProps {
  updateInfo: UpdateInfo
  visible: boolean
  onClose: () => void
}

export function UpdateNotification({ updateInfo, visible, onClose }: UpdateNotificationProps) {
  const [downloadProgress, setDownloadProgress] = useState<ProgressInfo | null>(null)
  const [isDownloaded, setIsDownloaded] = useState(false)
  const { message } = App.useApp()

  // 监听下载进度
  useEffect(() => {
    const handleDownloadProgress = (_: Electron.IpcRendererEvent, progress: ProgressInfo) => {
      setDownloadProgress(progress)
    }

    const handleUpdateDownloaded = (_: Electron.IpcRendererEvent) => {
      setIsDownloaded(true)
    }

    const handleUpdateError = (_: Electron.IpcRendererEvent, error: any) => {
      console.error('更新错误:', error)
      message.error(`更新失败: ${error?.message || error}`)
    }

    ipc.on('update:download-progress', handleDownloadProgress)
    ipc.on('update:update-downloaded', handleUpdateDownloaded)
    ipc.on('update:update-error', handleUpdateError)

    return () => {
      window.electron.ipcRenderer.removeAllListeners('update:download-progress')
      window.electron.ipcRenderer.removeAllListeners('update:update-downloaded')
      window.electron.ipcRenderer.removeAllListeners('update:update-error')
    }
  }, [])

  // 开始下载更新
  const handleDownload = useCallback(async () => {
    try {
      await updateApi.downloadUpdate()
    }
    catch (error) {
      console.error('下载更新失败:', error)
      message.error(`更新失败: ${(error as Error)?.message || error}`)
    }
  }, [])

  // 立即重启并安装
  const handleInstallNow = useCallback(() => {
    updateApi.quitAndInstall()
  }, [])

  // 稍后重启
  const handleInstallLater = useCallback(() => {
    onClose()
  }, [onClose])

  // 格式化文件大小
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0)
      return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${Number.parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`
  }

  // 格式化下载速度
  const formatSpeed = (bytesPerSecond: number): string => {
    return `${formatFileSize(bytesPerSecond)}/s`
  }

  const isDownloading = downloadProgress !== null && !isDownloaded

  return (
    <Modal
      title={(
        <Space>
          <ExclamationCircleOutlined className="text-blue-500" />
          发现新版本
        </Space>
      )}
      open={visible}
      onCancel={onClose}
      width={600}
      footer={null}
      maskClosable={!isDownloading}
      closable={!isDownloading}
    >
      <div className="py-4">
        {/* 版本信息 */}
        <div className="mb-6">
          <Title level={4} className="mb-2">
            版本
            {' '}
            {updateInfo.version}
          </Title>
          <div className="mb-4 flex justify-between text-sm text-gray-600">
            <span>
              发布日期:
              {new Date(updateInfo.releaseDate).toLocaleDateString()}
            </span>
            <span>
              大小:
              {formatFileSize(updateInfo.downloadSize)}
            </span>
          </div>
        </div>

        {/* 更新日志 */}
        {updateInfo.releaseNotes && (
          <div className="mb-6">
            <Title level={5} className="mb-3">
              更新内容
            </Title>
            <div className="max-h-60 overflow-y-auto rounded border bg-gray-50 p-3">
              <RenderMarkdown
                content={
                  typeof updateInfo.releaseNotes === 'string'
                    ? updateInfo.releaseNotes
                    : updateInfo.releaseNotes.map(item => `### ${item.version} \n\n ${item.note}`).join('\n\n')
                }
              />
            </div>
          </div>
        )}

        {/* 下载进度 */}
        {isDownloading && downloadProgress && (
          <div className="mb-6">
            <Title level={5} className="mb-3">
              下载进度
            </Title>
            <Progress
              percent={Math.round(downloadProgress.percent)}
              status="active"
              strokeColor="#1890ff"
            />
            <div className="mt-2 flex justify-between text-sm text-gray-600">
              <span>
                {formatFileSize(downloadProgress.transferred)}
                {' '}
                /
                {formatFileSize(downloadProgress.total)}
              </span>
              <span>{formatSpeed(downloadProgress.bytesPerSecond)}</span>
            </div>
          </div>
        )}

        {/* 操作按钮 */}
        <div className="flex justify-end gap-3">
          {!isDownloading && !isDownloaded && (
            <>
              <Button onClick={onClose}>
                稍后提醒
              </Button>
              <Button
                type="primary"
                icon={<DownloadOutlined />}
                onClick={handleDownload}
              >
                立即下载
              </Button>
            </>
          )}

          {isDownloading && (
            <Button
              onClick={() => {
                updateApi.cancelDownload()
                setDownloadProgress(null)
              }}
            >
              取消下载
            </Button>
          )}

          {isDownloaded && (
            <>
              <Button onClick={handleInstallLater}>
                稍后重启
              </Button>
              <Button type="primary" onClick={handleInstallNow}>
                立即重启并安装
              </Button>
            </>
          )}
        </div>

        {/* 提示信息 */}
        {isDownloaded && (
          <div className="mt-4 rounded border border-green-200 bg-green-50 p-3">
            <Text type="success">
              更新已下载完成，重启应用后将自动安装新版本。
            </Text>
          </div>
        )}
      </div>
    </Modal>
  )
}
