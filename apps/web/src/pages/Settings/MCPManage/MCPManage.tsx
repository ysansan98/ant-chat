import type { AddMcpConfigSchema, McpConfigSchema, SSEMcpConfig, StdioMcpConfig, UpdateMcpConfigSchema } from '@ant-chat/shared'
import { Button } from '@workspace/ui/components/button'
import { Plus } from 'lucide-react'
import React from 'react'
import { toast } from 'sonner'
import { addMcpConfigAction, connectMcpServerAction, deleteMcpConfigAction, disconnectMcpServerAction, initializeMcpConfigs, reconnectMcpServerAction, upadteMcpConfigAction, useMcpConfigsStore } from '@/store/mcpConfigs'
import { SettingsPageHeader } from '../SettingsPageHeader'
import { MCPList } from './MCPList'

const McpConfigDrawer = React.lazy(() => import('@/components/MCPManage/McpConfigDrawer'))

export default function MCPManage() {
  const [open, setOpen] = React.useState(false)
  const [mode, setMode] = React.useState<'add' | 'edit'>('add')
  const [editData, setEditData] = React.useState<McpConfigSchema | null>(null)
  const data = useMcpConfigsStore(state => state.mcpConfigs)
  const mcpServerRuningStatusMap = useMcpConfigsStore(state => state.mcpServerRuningStatusMap)
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
      <div className="">
        <Button
          onClick={() => {
            setMode('add')
            setEditData(null)
            setOpen(true)
          }}
        >
          <Plus className="size-3.5" />
          添加服务器
        </Button>
      </div>
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
          if (action !== 'edit') {
            await refreshAsync()
          }
        }}
      />
      <React.Suspense>
        <McpConfigDrawer
          key={editData?.serverName || mode}
          open={open}
          mode={mode}
          defaultValues={mode === 'edit' && editData ? editData : undefined}
          onClose={() => setOpen(false)}
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
