import type { McpServerStatus } from '@ant-chat/shared'
import { Badge } from '@workspace/ui/components/badge'
import { Loader2 } from 'lucide-react'

export function McpServerStatusBadge({
  statusMap,
  serverName,
  enabled,
}: {
  statusMap: Record<string, McpServerStatus>
  serverName: string
  enabled: boolean
}) {
  const status = statusMap[serverName] || 'disconnected'

  if (status === 'disconnected') {
    return <Badge variant="secondary">{enabled ? '未运行' : '已停止'}</Badge>
  }

  return status === 'connected'
    ? <Badge variant="default">运行中</Badge>
    : (
        <Badge variant="destructive">
          <Loader2 className="size-3 animate-spin" />
          启动中
        </Badge>
      )
}
