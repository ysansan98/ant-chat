import type { McpConfigSchema } from '@ant-chat/shared'
import type { McpConfigActionsProps } from './McpConfigActions'
import { Switch } from '@workspace/ui/components/switch'
import { useMcpConfigsStore } from '@/store/mcpConfigs'
import { McpConfigActions } from './McpConfigActions'
import { McpServerStatusBadge } from './mcpServerStatus'

interface MCPListProps {
  items?: McpConfigSchema[]
  selectedServerName?: string | null
  onSelect?: (serverName: string) => void
  onTriggerAction?: McpConfigActionsProps['onTriggerAction']
}

export function MCPList({ items, selectedServerName, onSelect, onTriggerAction }: MCPListProps) {
  const connectStatusMap = useMcpConfigsStore(state => state.mcpServerRuningStatusMap)

  return (
    <div className="flex flex-col gap-4 pt-4">
      {
        items?.map(item => (
          <div
            className={`
              flex cursor-pointer flex-col gap-2 rounded-xl border border-solid
              border-(--border-color) px-4 py-3 transition-colors
              ${selectedServerName === item.serverName ? 'border-primary/40 bg-accent/50' : 'hover:bg-accent/30'}
            `}
            key={item.serverName}
            onClick={() => onSelect?.(item.serverName)}
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate font-medium">{item.serverName}</span>
              <McpServerStatusBadge statusMap={connectStatusMap} serverName={item.serverName} enabled={item.enabled ?? true} />
            </div>
            {
              item.description && <p className="line-clamp-2 text-xs/4 text-muted-foreground">{item.description}</p>
            }
            <div className="flex items-center justify-between border-t border-(--border-color) pt-2">
              <div className="flex items-center gap-2" onClick={event => event.stopPropagation()}>
                <Switch
                  checked={item.enabled ?? true}
                  onCheckedChange={(checked) => {
                    onTriggerAction?.(checked ? 'enable' : 'disable', item)
                  }}
                  aria-label={`启用服务器：${item.serverName}`}
                />
                <span className="text-xs text-muted-foreground">{(item.enabled ?? true) ? '已启用' : '已禁用'}</span>
              </div>
              <McpConfigActions
                item={item}
                enabled={item.enabled ?? true}
                status={connectStatusMap[item.serverName] || 'disconnected'}
                onTriggerAction={onTriggerAction}
              />
            </div>
          </div>
        ))
      }
    </div>
  )
}
