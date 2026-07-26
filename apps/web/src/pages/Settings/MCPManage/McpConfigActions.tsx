import type { McpConfigSchema, McpServerStatus } from '@ant-chat/shared'
import { Button } from '@workspace/ui/components/button'
import { PauseCircle, Pencil, PlayCircle, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { McpDeleteDialog } from './McpDeleteDialog'

export interface McpConfigActionsProps {
  item: McpConfigSchema
  status: McpServerStatus
  onTriggerAction?: (
    action: 'start' | 'stop' | 'edit' | 'delete',
    item: McpConfigSchema,
    options?: { deletePermissionRules?: boolean },
  ) => void | Promise<void>
}

export function McpConfigActions({ item, status, onTriggerAction }: McpConfigActionsProps) {
  const [deleteOpen, setDeleteOpen] = useState(false)

  return (
    <div className="flex items-center gap-2">
      {
        status === 'connected' && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`停止服务器：${item.serverName}`}
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
            aria-label={`启动服务器：${item.serverName}`}
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
        aria-label={`编辑服务器：${item.serverName}`}
        onClick={() => {
          onTriggerAction?.('edit', item)
        }}
      >
        <Pencil />
      </Button>
      {
        status === 'disconnected' && (
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`删除服务器：${item.serverName}`}
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 />
            </Button>
            <McpDeleteDialog
              item={item}
              open={deleteOpen}
              onOpenChange={setDeleteOpen}
              onDelete={async (deletePermissionRules) => {
                await onTriggerAction?.('delete', item, { deletePermissionRules })
              }}
            />
          </>
        )
      }
    </div>
  )
}
