import type { UpdateConfig } from '@ant-chat/shared'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent } from '@workspace/ui/components/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/components/select'
import { Separator } from '@workspace/ui/components/separator'
import { Switch } from '@workspace/ui/components/switch'
import { CheckCircle, RefreshCw, Settings } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { updateApi } from '@/api/updateApi'

export function AboutUpdateSettings() {
  const [config, setConfig] = useState<UpdateConfig | null>(null)
  const [currentVersion, setCurrentVersion] = useState<string>('')
  const [isChecking, setIsChecking] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  // 更新配置
  const updateConfig = useCallback(async (updates: Partial<UpdateConfig>) => {
    if (!config)
      return

    try {
      const newConfig = { ...config, ...updates }
      const updatedConfig = await updateApi.setUpdateConfig(newConfig)
      setConfig(updatedConfig)
      toast.success('设置已保存')
    }
    catch (error) {
      console.error('保存设置失败:', error)
      toast.error('保存设置失败')
    }
  }, [config])

  // 手动检查更新
  const handleCheckUpdate = useCallback(async () => {
    if (isLoading) {
      return
    }
    setIsChecking(true)
    try {
      const updateInfo = await updateApi.checkForUpdates()
      if (updateInfo) {
        toast.success(`发现新版本 ${updateInfo.version}`)
      }
      else {
        toast.info('当前已是最新版本')
      }
    }
    catch (error) {
      console.error('检查更新失败:', error)
      toast.error('检查更新失败')
    }
    finally {
      setIsChecking(false)
    }
  }, [isLoading])

  // 加载初始数据
  useEffect(() => {
    const loadData = async () => {
      try {
        const [configData, version] = await Promise.all([
          updateApi.getUpdateConfig(),
          updateApi.getCurrentVersion(),
        ])
        setConfig(configData)
        setCurrentVersion(version)
      }
      catch (error) {
        console.error('加载更新设置失败:', error)
        toast.error('加载更新设置失败')
      }
      finally {
        setIsLoading(false)
      }
    }

    loadData()
  }, [])

  if (isLoading || !config) {
    return (
      <Card className="w-full">
        <CardContent className="h-32" />
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-3 text-sm">
      {/* 版本信息卡片 */}
      <Card size="sm" className="w-full">
        <CardContent className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <CheckCircle className="size-4 text-green-500" />
            <span className="">当前版本</span>
            <span className="font-bold">{currentVersion}</span>
          </div>
          <Button
            onClick={handleCheckUpdate}
            disabled={isChecking}
          >
            <RefreshCw className="size-4" />
            {isChecking ? '检查中...' : '检查更新'}
          </Button>
        </CardContent>
      </Card>

      {/* 更新设置卡片 */}
      <Card size="sm" className="w-full">
        <CardContent className="">
          <div className="flex items-center gap-2 text-base font-semibold">
            <Settings className="size-4" />
            <span>更新设置</span>
          </div>
        </CardContent>
        <CardContent className="flex flex-col gap-3 pt-0">
          {/* 自动检查更新 */}
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold">自动检查更新</p>
              <p className="text-sm text-muted-foreground">
                启用后将定期检查新版本
              </p>
            </div>
            <Switch
              checked={config.autoCheck}
              onCheckedChange={checked => updateConfig({ autoCheck: checked })}
            />
          </div>

          {/* 检查频率设置 */}
          {config.autoCheck && (
            <>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold">检查频率</p>
                  <p className="text-sm text-muted-foreground">
                    设置自动检查更新的时间间隔
                  </p>
                </div>
                <Select
                  items={{ startup: '启动时', daily: '每天', weekly: '每周' }}
                  value={config.checkInterval}
                  onValueChange={(value) => {
                    if (value) {
                      updateConfig({ checkInterval: value as UpdateConfig['checkInterval'] })
                    }
                  }}
                >
                  <SelectTrigger className="w-30">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="startup">启动时</SelectItem>
                    <SelectItem value="daily">每天</SelectItem>
                    <SelectItem value="weekly">每周</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          <Separator />

          {/* 自动下载更新 */}
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold">自动下载更新</p>
              <p className="text-sm text-muted-foreground">
                发现新版本时自动下载到后台
              </p>
            </div>
            <Switch
              checked={config.autoDownload}
              onCheckedChange={checked => updateConfig({ autoDownload: checked })}
            />
          </div>

          <Separator />

          {/* 包含预发布版本 */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <p className="font-semibold">包含预发布版本</p>
              <Badge variant="outline" className="text-xs">Beta</Badge>
            </div>
            <div className="flex items-center gap-1 text-right">
              <p className="text-xs text-muted-foreground">
                包含测试版本和候选版本
              </p>
              <Switch
                checked={config.includePrerelease}
                onCheckedChange={checked => updateConfig({ includePrerelease: checked })}
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
