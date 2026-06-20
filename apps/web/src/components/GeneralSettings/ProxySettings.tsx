import type { ProxySettings as ProxySettingsType } from '@ant-chat/shared'
import { Button } from '@workspace/ui/components/button'
import { Input } from '@workspace/ui/components/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/components/select'
import React from 'react'
import { toast } from 'sonner'
import { getAppRpcClient } from '@/api/transports/appRpc'
import { updateProxySettings } from '@/store/generalSettings/actions'
import { useGeneralSettingsStore } from '@/store/generalSettings/store'

interface ProxySettingsProps {
  draftMode: ProxySettingsType['mode']
  onModeChange: (mode: ProxySettingsType['mode']) => void
}

// 代理模式选择组件
export function ProxySettings({ draftMode, onModeChange }: ProxySettingsProps) {
  const isLoading = useGeneralSettingsStore(state => state.isLoading)

  return (
    <Select
      value={draftMode}
      onValueChange={onModeChange}
      disabled={isLoading}
    >
      <SelectTrigger className="min-w-32">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">不使用代理</SelectItem>
        <SelectItem value="system">系统代理</SelectItem>
        <SelectItem value="custom">自定义代理</SelectItem>
      </SelectContent>
    </Select>
  )
}

// 自定义代理URL配置组件
export function CustomProxyUrl() {
  const proxySettings = useGeneralSettingsStore(state => state.proxySettings)
  const isLoading = useGeneralSettingsStore(state => state.isLoading)

  const [testing, setTesting] = React.useState(false)
  const [testResult, setTestResult] = React.useState<boolean | null>(null)

  const handleUrlBlur = async (e: React.FocusEvent<HTMLInputElement>) => {
    const tempUrl = e.target.value.trim()

    if (!(tempUrl.includes('://'))) {
      toast.error('代理地址必须包含协议头，例如：http://127.0.0.1:7890')
      return
    }

    if (tempUrl && tempUrl !== proxySettings.customProxyUrl) {
      try {
        await updateProxySettings({ mode: 'custom', customProxyUrl: tempUrl })
        toast.success('代理设置已更新')
      }
      catch {
        toast.error('代理地址更新失败')
      }
    }
  }

  const handleTestProxy = async () => {
    const urlToTest = proxySettings.customProxyUrl
    if (!urlToTest) {
      toast.warning('请先配置代理地址')
      return
    }

    if (!urlToTest.includes('://')) {
      toast.error('代理地址必须包含协议头，例如：http://127.0.0.1:7890')
      return
    }

    setTesting(true)
    try {
      const result = await getAppRpcClient().call('settings.testProxyConnection', { proxyUrl: urlToTest })

      setTestResult(result)
      if (result) {
        toast.success('代理连接成功')
      }
      else {
        toast.error('代理连接失败')
      }
    }
    catch {
      toast.error('代理测试失败')
    }
    finally {
      setTesting(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        defaultValue={proxySettings.customProxyUrl || ''}
        onBlur={handleUrlBlur}
        placeholder="http://127.0.0.1:7890"
        className="flex-1"
        disabled={isLoading}
      />
      {
        proxySettings.customProxyUrl?.includes('://')
        && proxySettings.mode === 'custom'
        && (
          <Button
            onClick={handleTestProxy}
            disabled={isLoading || testing}
          >
            {testing ? '测试中...' : '测试连接'}
          </Button>
        )
      }
      {
        testResult !== null && (
          <span style={{ color: testResult ? '#52c41a' : '#ff4d4f' }}>
            {testResult ? '✓' : '✗'}
          </span>
        )
      }
    </div>
  )
}
