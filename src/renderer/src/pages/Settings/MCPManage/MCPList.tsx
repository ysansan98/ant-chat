import type { McpConfigSchema } from '@ant-chat/shared'
import type { McpConfigActionsProps } from './McpConfigActions'
import { Badge } from '@workspace/ui/components/badge'
import { Loader2 } from 'lucide-react'
import { useMcpConfigsStore } from '@/store/mcpConfigs'
import { McpConfigActions } from './McpConfigActions'

interface MCPListProps {
  items?: McpConfigSchema[]
  onTriggerAction?: McpConfigActionsProps['onTriggerAction']
}

export function MCPList({ items, onTriggerAction }: MCPListProps) {
  const connectStatusMap = useMcpConfigsStore(state => state.mcpServerRuningStatusMap)

  return (
    <div className="flex flex-col gap-4 pt-4">
      {
        items?.map(item => (
          <div
            className={`
              flex items-center justify-between rounded-xl border border-solid
              border-(--border-color) px-4 py-2
            `}
            key={item.serverName}
          >
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xl">{item.icon}</span>
                <span>{item.serverName}</span>
                <span>
                  {getMcpServerRunStatus(connectStatusMap, item.serverName)}
                </span>
              </div>
              {
                item.description && <div className="pt-2 text-sm text-gray-400">{item.description}</div>
              }
            </div>
            <McpConfigActions
              item={item}
              status={connectStatusMap[item.serverName] || 'disconnected'}
              onTriggerAction={onTriggerAction}
            />
          </div>
        ))
      }
    </div>
  )
}

function getMcpServerRunStatus(statusMap: Record<string, 'connected' | 'connecting' | 'disconnected'>, name: string) {
  const status = statusMap[name] || 'disconnected'

  if (status === 'disconnected') {
    return <Badge variant="secondary">已停止</Badge>
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
