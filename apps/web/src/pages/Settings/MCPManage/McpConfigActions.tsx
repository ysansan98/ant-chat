import type { McpConfigSchema, McpServerStatus } from '@ant-chat/shared'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@workspace/ui/components/alert-dialog'
import { Button } from '@workspace/ui/components/button'
import { PauseCircle, Pencil, PlayCircle, Trash2 } from 'lucide-react'

export interface McpConfigActionsProps {
  item: McpConfigSchema
  status: McpServerStatus
  onTriggerAction?: (action: 'start' | 'stop' | 'edit' | 'delete', item: McpConfigSchema) => void | Promise<void>
}

export function McpConfigActions({ item, status, onTriggerAction }: McpConfigActionsProps) {
  return (
    <div className="flex items-center gap-2">
      {
        status === 'connected' && (
          <Button
            variant="ghost"
            size="icon-sm"
            title="停止"
            onClick={() => {
              onTriggerAction?.('stop', item)
            }}
          >
            <PauseCircle />
          </Button>
        )
      }
      {
        status === 'disconnected' && (
          <Button
            variant="ghost"
            size="icon-sm"
            title="启动"
            onClick={() => {
              onTriggerAction?.('start', item)
            }}
          >
            <PlayCircle />
          </Button>
        )
      }
      <Button
        variant="ghost"
        size="icon-sm"
        title="编辑"
        onClick={() => {
          onTriggerAction?.('edit', item)
        }}
      >
        <Pencil />
      </Button>
      {
        status === 'disconnected' && (
          <AlertDialog>
            <AlertDialogTrigger render={(
              <Button variant="ghost" size="icon-sm" title="删除">
                <Trash2 />
              </Button>
            )}
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  删除
                  {item.serverName}
                  服务器
                </AlertDialogTitle>
                <AlertDialogDescription>
                  删除后将无法使用该服务器
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={async () => {
                    await onTriggerAction?.('delete', item)
                  }}
                >
                  删除
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )
      }
    </div>
  )
}
