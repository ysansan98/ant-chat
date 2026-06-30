import type { AddMcpConfigSchema, McpConfigSchema, SSEMcpConfig, StdioMcpConfig, UpdateMcpConfigSchema } from '@ant-chat/shared'
import { Button } from '@workspace/ui/components/button'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { Switch } from '@workspace/ui/components/switch'
import { Plus } from 'lucide-react'
import React from 'react'
import { toast } from 'sonner'
import { setEnableMCP, useChatSttingsStore } from '@/store/chatSettings'
import { addMcpConfigAction, connectMcpServerAction, deleteMcpConfigAction, disconnectMcpServerAction, initializeMcpConfigs, reconnectMcpServerAction, upadteMcpConfigAction, useMcpConfigsStore } from '@/store/mcpConfigs'
import { SettingsPageHeader } from '../SettingsPageHeader'
import { MCPList } from './MCPList'

const McpConfigDrawer = React.lazy(() => import('@/components/MCPManage/McpConfigDrawer'))

export default function MCPManage() {
  const [open, setOpen] = React.useState(false)
  const [mode, setMode] = React.useState<'add' | 'edit'>('add')
  const [editData, setEditData] = React.useState<McpConfigSchema | null>(null)
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
    <div className="flex flex-col gap-4 p-4">
      <SettingsPageHeader
        title="MCP 设置"
        description="管理模型上下文协议服务器及其连接状态。"
      />
      <div className={`
        flex items-center justify-between rounded-xl border border-solid border-(--border-color) px-4 py-3
      `}
      >
        <div>
          <h2 className="text-base leading-6 font-semibold">启用 MCP 功能</h2>
          <p className="mt-0.5 text-xs leading-4 text-muted-foreground">开启后可配置和连接 MCP 服务器。</p>
        </div>
        <div>
          <Switch checked={enableMCP} onCheckedChange={setEnableMCP} />
        </div>
      </div>
      {
        enableMCP
          ? (
              <>
                <div className="">
                  <Button
                    onClick={() => {
                      setMode('add')
                      setEditData(null)
                      setOpen(true)
                    }}
                  >
                    <Plus />
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
                      const nextConfig = e as McpConfigSchema

                      if (mode === 'add') {
                        try {
                          await addMcpConfigAction(nextConfig)
                          setOpen(false)
                          await refreshAsync()
                        }
                        catch (err) {
                          toast.error((err as Error).message || '添加失败')
                        }
                      }

                      // 如果修改了名称，需要先删掉数据重新添加
                      if (editData?.serverName && editData?.serverName !== e.serverName) {
                        await deleteMcpConfigAction(editData.serverName)
                        await disconnectMcpServerAction(editData.serverName)
                        await addMcpConfigAction(nextConfig)

                        if (mcpServerRuningStatusMap[editData?.serverName] === 'connected') {
                          await connectMcpServerAction(e.serverName)
                        }
                      }
                      else {
                        await upadteMcpConfigAction(nextConfig)

                        // 如果MCP服务是在运行中且修改了 transportType、url、command、args、env 其中之一，需要重新连接
                        if (
                          e.serverName in mcpServerRuningStatusMap
                          && mcpServerRuningStatusMap[e.serverName] === 'connected'
                          && checkNeedReconnect(editData as McpConfigSchema, nextConfig)
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
              <EmptyState>
                <h2 className="text-balance text-base leading-6 font-semibold">MCP 功能未启用</h2>
                <p className="text-sm text-muted-foreground">启用后即可添加和管理服务器。</p>
              </EmptyState>
            )
      }
    </div>
  )
}

function checkNeedReconnect(oldConfig: McpConfigSchema, newConfig: McpConfigSchema): boolean {
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
