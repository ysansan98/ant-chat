import type { WorkspaceItem } from '@ant-chat/shared'
import { Alert, AlertDescription, AlertTitle } from '@workspace/ui/components/alert'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@workspace/ui/components/alert-dialog'
import { Button } from '@workspace/ui/components/button'
import { Checkbox } from '@workspace/ui/components/checkbox'
import { AlertTriangle } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import permissionsApi from '@/api/permissionsApi'

export function WorkspaceDeleteDialog({
  item,
  open,
  onOpenChange,
  onDelete,
}: {
  item: WorkspaceItem
  open: boolean
  onOpenChange: (open: boolean) => void
  onDelete: (path: string, deletePermissionGroup: boolean) => Promise<void>
}) {
  const [permissionCount, setPermissionCount] = useState(0)
  const [deletePermissionGroup, setDeletePermissionGroup] = useState(true)
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
      setPermissionCount(permissions.workspaces[item.path]?.length ?? 0)
      setDeletePermissionGroup(true)
    }
    catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '读取工作区权限失败')
      setErrorKind('load')
    }
    finally {
      setLoading(false)
    }
  }, [item.path])

  useEffect(() => {
    if (open)
      void loadPermissionCount()
  }, [loadPermissionCount, open])

  async function handleDelete() {
    setSubmitting(true)
    setError('')
    setErrorKind(null)
    try {
      await onDelete(item.path, permissionCount > 0 && deletePermissionGroup)
      onOpenChange(false)
    }
    catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '删除工作区失败')
      setErrorKind('delete')
      setSubmitting(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent size="sm" onClick={event => event.stopPropagation()}>
        <AlertDialogHeader>
          <AlertDialogTitle>删除工作区</AlertDialogTitle>
          <AlertDialogDescription>
            确定要删除工作区「
            {item.displayName}
            」吗？此操作不会删除磁盘上的文件，仅从列表中移除。
          </AlertDialogDescription>
        </AlertDialogHeader>

        {loading && <p role="status" className="px-4 text-sm text-muted-foreground">正在检查权限规则…</p>}

        {!loading && permissionCount > 0 && !error && (
          <label className="mx-4 flex items-center gap-2 text-sm">
            <Checkbox
              checked={deletePermissionGroup}
              onCheckedChange={checked => setDeletePermissionGroup(Boolean(checked))}
            />
            同时删除
            {' '}
            {permissionCount}
            {' '}
            条权限规则
          </label>
        )}

        {error && (
          <Alert variant="destructive" className="mx-4 w-auto">
            <AlertTriangle />
            <AlertTitle>工作区未删除</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-2">
              <span>{error}</span>
              {errorKind === 'load' && (
                <Button size="sm" variant="outline" onClick={() => void loadPermissionCount()}>重试检查</Button>
              )}
            </AlertDescription>
          </Alert>
        )}

        <AlertDialogFooter className="px-4 py-2">
          <AlertDialogCancel size="sm" disabled={submitting}>取消</AlertDialogCancel>
          <AlertDialogAction
            size="sm"
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
