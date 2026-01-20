import type { UpdateConfig } from '@ant-chat/shared'
import { CheckCircleOutlined, ReloadOutlined, SettingOutlined } from '@ant-design/icons'
import { Button, Card, Divider, message, Select, Switch, Tag, Typography } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { updateApi } from '@/api/updateApi'

const { Text } = Typography

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
      message.success('设置已保存')
    }
    catch (error) {
      console.error('保存设置失败:', error)
      message.error('保存设置失败')
    }
  }, [config])

  // 手动检查更新
  const handleCheckUpdate = useCallback(async () => {
    console.log('isLoading => ', isLoading)
    if (isLoading) {
      return
    }
    console.log('handleCheckUpdate start execute')
    setIsChecking(true)
    try {
      const updateInfo = await updateApi.checkForUpdates()
      if (updateInfo) {
        message.success(`发现新版本 ${updateInfo.version}`)
      }
      else {
        message.info('当前已是最新版本')
      }
    }
    catch (error) {
      console.error('检查更新失败:', error)
      message.error('检查更新失败')
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
        message.error('加载更新设置失败')
      }
      finally {
        setIsLoading(false)
      }
    }

    loadData()
  }, [])

  if (isLoading || !config) {
    return (
      <Card loading className="w-full">
        <div className="h-32" />
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {/* 版本信息卡片 */}
      <Card size="small" className="w-full">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CheckCircleOutlined className="text-2xl !text-green-500" />
            <span className="text-base">当前版本</span>
            <span className="text-base">{currentVersion}</span>
          </div>
          <Button
            type="primary"
            icon={<ReloadOutlined />}
            loading={isChecking}
            onClick={handleCheckUpdate}
          >
            {isChecking ? '检查中...' : '检查更新'}
          </Button>
        </div>
      </Card>

      {/* 更新设置卡片 */}
      <Card
        size="small"
        title={(
          <div className="flex items-center gap-2">
            <SettingOutlined />
            <span>更新设置</span>
          </div>
        )}
        className="w-full"
      >
        <div>
          {/* 自动检查更新 */}
          <div className="flex items-center justify-between">
            <div>
              <Text strong>自动检查更新</Text>
              <br />
              <Text type="secondary" className="text-sm">
                启用后将定期检查新版本
              </Text>
            </div>
            <Switch
              checked={config.autoCheck}
              onChange={checked => updateConfig({ autoCheck: checked })}
            />
          </div>

          {/* 检查频率设置 */}
          {config.autoCheck && (
            <>
              <Divider size="small" />
              <div className="flex items-center justify-between">
                <div>
                  <Text strong>检查频率</Text>
                  <br />
                  <Text type="secondary" className="text-sm">
                    设置自动检查更新的时间间隔
                  </Text>
                </div>
                <Select
                  value={config.checkInterval}
                  onChange={value => updateConfig({ checkInterval: value })}
                  style={{ width: 120 }}
                  options={[
                    { label: '启动时', value: 'startup' },
                    { label: '每天', value: 'daily' },
                    { label: '每周', value: 'weekly' },
                  ]}
                />
              </div>
            </>
          )}

          <Divider size="small" />

          {/* 自动下载更新 */}
          <div className="flex items-center justify-between">
            <div>
              <Text strong>自动下载更新</Text>
              <br />
              <Text type="secondary" className="text-sm">
                发现新版本时自动下载到后台
              </Text>
            </div>
            <Switch
              checked={config.autoDownload}
              onChange={checked => updateConfig({ autoDownload: checked })}
            />
          </div>

          <Divider size="small" />

          {/* 包含预发布版本 */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Text strong>包含预发布版本</Text>
              <Tag color="orange" className="text-xs">Beta</Tag>
            </div>
            <div className="flex items-center gap-1 text-right">
              <Text type="secondary" className="text-xs">
                包含测试版本和候选版本
              </Text>
              <Switch
                checked={config.includePrerelease}
                onChange={checked => updateConfig({ includePrerelease: checked })}
              />
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
}
