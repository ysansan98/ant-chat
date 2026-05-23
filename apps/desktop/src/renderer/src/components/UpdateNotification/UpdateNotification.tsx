import type { ProgressInfo, UpdateInfo } from '@ant-chat/shared'
import { MessageResponse } from '@workspace/ui/components/ai-elements/message'
import { Button } from '@workspace/ui/components/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@workspace/ui/components/dialog'
import { Progress } from '@workspace/ui/components/progress'
import { AlertTriangle, Download } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { updateApi } from '@/api/updateApi'
import { ipcRenderer } from '@/utils/ipc-bus'

export interface UpdateNotificationProps {
  updateInfo: UpdateInfo
  visible: boolean
  onClose: () => void
}

export function UpdateNotification({ updateInfo, visible, onClose }: UpdateNotificationProps) {
  const [downloadProgress, setDownloadProgress] = useState<ProgressInfo | null>(null)
  const [isDownloaded, setIsDownloaded] = useState(false)

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
      toast.error(`更新失败: ${error?.message || error}`)
    }

    ipcRenderer.on('update:download-progress', handleDownloadProgress)
    ipcRenderer.on('update:update-downloaded', handleUpdateDownloaded)
    ipcRenderer.on('update:update-error', handleUpdateError)

    return () => {
      ipcRenderer.removeAllListeners('update:download-progress')
      ipcRenderer.removeAllListeners('update:update-downloaded')
      ipcRenderer.removeAllListeners('update:update-error')
    }
  }, [])

  // 开始下载更新
  const handleDownload = async () => {
    try {
      await updateApi.downloadUpdate()
    }
    catch (error) {
      console.error('下载更新失败:', error)
      toast.error(`更新失败: ${(error as Error)?.message || error}`)
    }
  }

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
    <Dialog open={visible} onOpenChange={isDownloading ? undefined : onClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="text-blue-500" />
            发现新版本
          </DialogTitle>
        </DialogHeader>
        <div className="py-2">
          {/* 版本信息 */}
          <div className="mb-6">
            <h4 className="mb-2 text-lg font-bold">
              版本
              {' '}
              {updateInfo.version}
            </h4>
            <div className="mb-4 flex justify-between text-sm text-muted-foreground">
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
              <h5 className="mb-3 font-bold">
                更新内容
              </h5>
              <div className="max-h-60 overflow-y-auto rounded-sm border bg-muted p-3">
                <MessageResponse>
                  {typeof updateInfo.releaseNotes === 'string'
                    ? updateInfo.releaseNotes
                    : updateInfo.releaseNotes.map(item => `### ${item.version} \n\n ${item.note}`).join('\n\n')}
                </MessageResponse>
              </div>
            </div>
          )}

          {/* 下载进度 */}
          {isDownloading && downloadProgress && (
            <div className="mb-6">
              <h5 className="mb-3 font-bold">
                下载进度
              </h5>
              <Progress value={Math.round(downloadProgress.percent)} />
              <div className="mt-2 flex justify-between text-sm text-muted-foreground">
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
                <Button variant="outline" onClick={onClose}>
                  稍后提醒
                </Button>
                <Button onClick={handleDownload}>
                  <Download />
                  立即下载
                </Button>
              </>
            )}

            {isDownloading && (
              <Button
                variant="outline"
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
                <Button variant="outline" onClick={handleInstallLater}>
                  稍后重启
                </Button>
                <Button onClick={handleInstallNow}>
                  立即重启并安装
                </Button>
              </>
            )}
          </div>

          {/* 提示信息 */}
          {isDownloaded && (
            <div className="mt-4 rounded-sm border border-green-200 bg-green-50 p-3">
              <p className="text-sm text-green-600">
                更新已下载完成，重启应用后将自动安装新版本。
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
