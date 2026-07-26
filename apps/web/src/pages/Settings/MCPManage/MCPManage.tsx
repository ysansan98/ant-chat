import type { AddMcpConfigSchema, McpConfigSchema, UpdateMcpConfigSchema } from '@ant-chat/shared'
import { Button } from '@workspace/ui/components/button'
import { Plus } from 'lucide-react'
import React from 'react'
import { toast } from 'sonner'
import permissionsApi from '@/api/permissionsApi'
import { deleteMcpServerAction, editMcpServerAction, initializeMcpConfigs, installMcpServerAction, startMcpServerAction, stopMcpServerAction, useMcpConfigsStore } from '@/store/mcpConfigs'
import { SettingsPageLayout } from '../SettingsPageLayout'
import { MCPList } from './MCPList'
import { countMcpRules } from './mcpPermissionRules'

const McpConfigDrawer = React.lazy(() => import('@/components/MCPManage/McpConfigDrawer'))

export default function MCPManage() {
  const [open, setOpen] = React.useState(false)
  const [mode, setMode] = React.useState<'add' | 'edit'>('add')
  const [editData, setEditData] = React.useState<McpConfigSchema | null>(null)
  const [renamePermissionRuleCount, setRenamePermissionRuleCount] = React.useState(0)
  const data = useMcpConfigsStore(state => state.mcpConfigs)

  React.useEffect(() => {
    initializeMcpConfigs()
  }, [])

  return (
    <SettingsPageLayout
      title="MCP 设置"
      description="管理模型上下文协议服务器及其连接状态。"
      variant="wide"
    >
      <Button
        onClick={() => {
          setMode('add')
          setEditData(null)
          setOpen(true)
        }}
        className="self-start"
      >
        <Plus className="size-3.5" />
        添加服务器
      </Button>
      <MCPList
        items={data}
        onTriggerAction={async (action, item, options) => {
          switch (action) {
            case 'delete': {
              const result = await deleteMcpServerAction(item.serverName, options?.deletePermissionRules ?? false)
              if (result.error)
                throw new Error(result.error)
              break
            }

            case 'start': {
              const result = await startMcpServerAction(item.serverName)
              if (result.error)
                toast.error(result.error)
              break
            }
            case 'stop': {
              const result = await stopMcpServerAction(item.serverName)
              if (result.error)
                toast.error(result.error)
              break
            }
            case 'edit': {
              try {
                const permissions = await permissionsApi.list()
                setRenamePermissionRuleCount(countMcpRules(permissions, item.serverName))
                setEditData(item)
                setMode('edit')
                setOpen(true)
              }
              catch (error) {
                toast.error(error instanceof Error ? error.message : '读取 MCP 权限失败')
              }
              break
            }
            default:
              break
          }
        }}
      />
      <React.Suspense>
        <McpConfigDrawer
          key={editData?.serverName || mode}
          open={open}
          mode={mode}
          defaultValues={mode === 'edit' && editData ? editData : undefined}
          renamePermissionRuleCount={renamePermissionRuleCount}
          onClose={() => setOpen(false)}
          onSave={async (e: AddMcpConfigSchema | UpdateMcpConfigSchema) => {
            const nextConfig = e as McpConfigSchema

            if (mode === 'add') {
              try {
                const result = await installMcpServerAction(nextConfig)
                if (result.error)
                  toast.error(result.configSaved ? `配置已保存，但启动失败：${result.error}` : result.error)
                setOpen(false)
                return
              }
              catch (err) {
                toast.error((err as Error).message || '添加失败')
              }
            }

            if (mode === 'edit' && editData?.serverName) {
              try {
                const result = await editMcpServerAction(editData.serverName, nextConfig)
                if (result.error)
                  toast.error(result.configSaved ? `配置已保存，但重启失败：${result.error}` : `配置未保存：${result.error}`)
                setOpen(false)
              }
              catch (err) {
                toast.error((err as Error).message || '更新失败')
              }
            }
          }}
        />
      </React.Suspense>
    </SettingsPageLayout>
  )
}
