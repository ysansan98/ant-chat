import { App, Button, Input, Select } from 'antd'
import React from 'react'
import { updateProxySettings } from '@/store/generalSettings/actions'
import { useGeneralSettingsStore } from '@/store/generalSettings/store'
import { emitter, unwrapIpcResponse } from '@/utils/ipc-bus'

const proxyOptions = [
  { value: 'none', label: '不使用代理' },
  { value: 'system', label: '系统代理' },
  { value: 'custom', label: '自定义代理' },
]

// 代理模式选择组件
export function ProxySettings() {
  const { message } = App.useApp()
  const proxySettings = useGeneralSettingsStore(state => state.proxySettings)
  const isLoading = useGeneralSettingsStore(state => state.isLoading)

  const handleProxyModeChange = async (mode: 'none' | 'system' | 'custom') => {
    try {
      await updateProxySettings({ mode })
      message.success('代理模式已更新')
    }
    catch {
      message.error('代理模式更新失败')
    }
  }

  return (
    <Select
      value={proxySettings.mode}
      onChange={handleProxyModeChange}
      options={proxyOptions}
      className="min-w-32"
      loading={isLoading}
      disabled={isLoading}
    />
  )
}

// 自定义代理URL配置组件
export function CustomProxyUrl() {
  const { message } = App.useApp()
  const proxySettings = useGeneralSettingsStore(state => state.proxySettings)
  const isLoading = useGeneralSettingsStore(state => state.isLoading)

  const [testing, setTesting] = React.useState(false)
  const [testResult, setTestResult] = React.useState<boolean | null>(null)

  const handleUrlBlur = async (e) => {
    const tempUrl = e.target.value.trim()

    if (!(tempUrl.includes('://'))) {
      message.error('代理地址必须包含协议头，例如：http://127.0.0.1:7890')
      return
    }

    if (tempUrl && tempUrl !== proxySettings.customProxyUrl) {
      try {
        await updateProxySettings({ customProxyUrl: tempUrl })
      }
      catch {
        message.error('代理地址更新失败')
      }
    }
  }

  const handleTestProxy = async () => {
    const urlToTest = proxySettings.customProxyUrl
    if (!urlToTest) {
      message.warning('请先配置代理地址')
      return
    }

    // 验证URL必须包含协议头
    if (!urlToTest.includes('://')) {
      message.error('代理地址必须包含协议头，例如：http://127.0.0.1:7890')
      return
    }

    setTesting(true)
    try {
      // 使用真实的代理测试API
      const response = await emitter.invoke('proxy:test-connection', urlToTest)
      const result = unwrapIpcResponse(response)

      setTestResult(result)
      message[result ? 'success' : 'error'](
        result ? '代理连接成功' : '代理连接失败',
      )
    }
    catch {
      message.error('代理测试失败')
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
            type="primary"
            onClick={handleTestProxy}
            loading={testing}
            disabled={isLoading}
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
