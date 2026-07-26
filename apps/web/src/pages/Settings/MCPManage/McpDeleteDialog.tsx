import type { McpConfigSchema } from '@ant-chat/shared'
import { Alert, AlertDescription, AlertTitle } from '@workspace/ui/components/alert'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@workspace/ui/components/alert-dialog'
import { Button } from '@workspace/ui/components/button'
import { Checkbox } from '@workspace/ui/components/checkbox'
import { AlertTriangle } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import permissionsApi from '@/api/permissionsApi'
import { countMcpRules } from './mcpPermissionRules'

export function McpDeleteDialog({
  item,
  open,
  onOpenChange,
  onDelete,
}: {
  item: McpConfigSchema
  open: boolean
  onOpenChange: (open: boolean) => void
  onDelete: (deletePermissionRules: boolean) => Promise<void>
}) {
  const [permissionCount, setPermissionCount] = useState(0)
  const [deletePermissionRules, setDeletePermissionRules] = useState(true)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [errorKind, setErrorKind] = useState<'load' | 'delete' | null>(null)

  const loadPermissionCount = useCallback(async () => {
    setLoading(true)
    setError('')
    setErrorKind(null)
    setPermissionCount(0)
    try {
      const permissions = await permissionsApi.list()
      setPermissionCount(countMcpRules(permissions, item.serverName))
      setDeletePermissionRules(true)
    }
    catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '读取 MCP 权限失败')
      setErrorKind('load')
    }
    finally {
      setLoading(false)
    }
  }, [item.serverName])

  useEffect(() => {
    if (open)
      void loadPermissionCount()
  }, [loadPermissionCount, open])

  async function handleDelete() {
    setSubmitting(true)
    setError('')
    setErrorKind(null)
    try {
      await onDelete(permissionCount > 0 && deletePermissionRules)
      onOpenChange(false)
    }
    catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '删除 MCP 服务器失败')
      setErrorKind('delete')
      setSubmitting(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            删除
            {item.serverName}
            服务器
          </AlertDialogTitle>
          <AlertDialogDescription>删除后将无法使用该服务器。</AlertDialogDescription>
        </AlertDialogHeader>

        {loading && <p role="status" className="text-sm text-muted-foreground">正在检查相关权限规则…</p>}

        {!loading && permissionCount > 0 && !error && (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={deletePermissionRules}
              onCheckedChange={checked => setDeletePermissionRules(Boolean(checked))}
            />
            同时删除
            {' '}
            {permissionCount}
            {' '}
            条相关权限规则
          </label>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertTitle>MCP 服务器未删除</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-2">
              <span>{error}</span>
              {errorKind === 'load' && (
                <Button size="sm" variant="outline" onClick={() => void loadPermissionCount()}>重试检查</Button>
              )}
            </AlertDescription>
          </Alert>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting}>取消</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={loading || errorKind === 'load' || submitting}
            onClick={() => void handleDelete()}
          >
            {submitting ? '删除中…' : error ? '重试删除' : '删除'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
