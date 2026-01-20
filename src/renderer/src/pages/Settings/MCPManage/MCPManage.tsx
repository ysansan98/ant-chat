import type { AddMcpConfigSchema, McpConfigSchema, SSEMcpConfig, StdioMcpConfig, UpdateMcpConfigSchema } from '@ant-chat/shared'
import { PlusOutlined } from '@ant-design/icons'
import { App, Button, Empty, Switch } from 'antd'
import React from 'react'
import { setEnableMCP, useChatSttingsStore } from '@/store/chatSettings'
import { addMcpConfigAction, connectMcpServerAction, deleteMcpConfigAction, disconnectMcpServerAction, initializeMcpConfigs, reconnectMcpServerAction, upadteMcpConfigAction, useMcpConfigsStore } from '@/store/mcpConfigs'
import { MCPList } from './MCPList'

const McpConfigDrawer = React.lazy(() => import('@/components/MCPManage/McpConfigDrawer'))

export default function MCPManage() {
  const [open, setOpen] = React.useState(false)
  const [mode, setMode] = React.useState<'add' | 'edit'>('add')
  const [editData, setEditData] = React.useState<McpConfigSchema | null>(null)
  const { message } = App.useApp()
  // const { data, refreshAsync } = useRequest(getAllMcpConfigs)
  const data = useMcpConfigsStore(state => state.mcpConfigs)
  const mcpServerRuningStatusMap = useMcpConfigsStore(state => state.mcpServerRuningStatusMap)
  // const { enableMCP, setEnableMCP } = useMcpStore()
  const enableMCP = useChatSttingsStore(state => state.enableMCP)
  const refreshAsync = initializeMcpConfigs

  React.useEffect(() => {
    initializeMcpConfigs()
  }, [])

  return (
    <div className="p-2">
      <div className={`
        mb-4 flex justify-between rounded-xl border border-solid border-(--border-color) p-4
      `}
      >
        <div>
          启用MCP功能
        </div>
        <div>
          <Switch value={enableMCP} onChange={setEnableMCP} />
        </div>
      </div>
      {
        enableMCP
          ? (
              <>
                <div className="">
                  <Button
                    icon={<PlusOutlined />}
                    onClick={() => {
                      setMode('add')
                      setEditData(null)
                      setOpen(true)
                    }}
                  >
                    添加服务器
                  </Button>
                  <MCPList
                    items={data}
                    onTriggerAction={async (action, item) => {
                      switch (action) {
                        case 'delete': {
                          if (mcpServerRuningStatusMap[item.serverName] === 'connected') {
                            await disconnectMcpServerAction(item.serverName)
                          }
                          await deleteMcpConfigAction(item.serverName)
                          break
                        }

                        case 'start':
                          await connectMcpServerAction(item.serverName)
                          break
                        case 'stop':
                          await disconnectMcpServerAction(item.serverName)
                          break
                        case 'edit':
                          setEditData(item)
                          setMode('edit')
                          setOpen(true)
                          break
                        default:
                          break
                      }
                      // 这里需要判断是否是编辑操作，如果不是编辑操作，则需要刷新列表
                      if (action !== 'edit') {
                        await refreshAsync()
                      }
                    }}
                  />
                </div>
                <React.Suspense>
                  <McpConfigDrawer
                    key={editData?.serverName || mode}
                    open={open}
                    mode={mode}
                    defaultValues={mode === 'edit' && editData ? editData : undefined}
                    onClose={() => {
                      setOpen(false)
                    }}
                    onSave={async (e: AddMcpConfigSchema | UpdateMcpConfigSchema) => {
                      const configWithTimestamp = {
                        ...e,
                        createdAt: mode === 'add' ? Date.now() : (editData?.createdAt || Date.now()),
                        updatedAt: Date.now(),
                      } as McpConfigSchema

                      if (mode === 'add') {
                        try {
                          await addMcpConfigAction(configWithTimestamp)
                          setOpen(false)
                          await refreshAsync()
                        }
                        catch (err) {
                          message.error((err as Error).message || '添加失败')
                        }
                      }

                      // 如果修改了名称，需要先删掉数据重新添加
                      if (editData?.serverName && editData?.serverName !== e.serverName) {
                        await deleteMcpConfigAction(editData.serverName)
                        await disconnectMcpServerAction(editData.serverName)
                        await addMcpConfigAction(configWithTimestamp)

                        if (mcpServerRuningStatusMap[editData?.serverName] === 'connected') {
                          await connectMcpServerAction(e.serverName)
                        }
                      }
                      else {
                        await upadteMcpConfigAction(configWithTimestamp)

                        // 如果MCP服务是在运行中且修改了 transportType、url、command、args、env 其中之一，需要重新连接
                        if (
                          e.serverName in mcpServerRuningStatusMap
                          && mcpServerRuningStatusMap[e.serverName] === 'connected'
                          && checkNeedReconnect(editData as McpConfigSchema, configWithTimestamp)
                        ) {
                          await reconnectMcpServerAction(e.serverName)
                        }
                      }
                      setOpen(false)
                      await refreshAsync()
                    }}
                  />
                </React.Suspense>
              </>
            )
          : (
              <Empty
                image={null}
                styles={{ image: { height: 0, width: 0 } }}
                description="请先启用MCP以访问配置选项"
              />
            )
      }
    </div>
  )
}

function checkNeedReconnect(oldConfig: McpConfigSchema, newConfig: McpConfigSchema): boolean {
  console.log('oldConfig: ', JSON.stringify(oldConfig), 'newConfig: ', JSON.stringify(newConfig))

  if (oldConfig.transportType !== newConfig.transportType) {
    return true
  }

  if (newConfig.transportType === 'sse') {
    return (oldConfig as SSEMcpConfig).url !== newConfig.url
  }

  else {
    if ((oldConfig as StdioMcpConfig).command !== (newConfig as StdioMcpConfig).command) {
      return true
    }

    return ['args', 'env'].some(field => JSON.stringify(oldConfig[field]) !== JSON.stringify(newConfig[field]))
  }
}
