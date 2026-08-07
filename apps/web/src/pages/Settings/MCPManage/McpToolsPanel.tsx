import type { McpTool } from '@ant-chat/shared'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { Input } from '@workspace/ui/components/input'
import { ChevronRight, Search } from 'lucide-react'
import { useState } from 'react'
import { useMcpConfigsStore } from '@/store/mcpConfigs'
import { McpServerStatusBadge } from './mcpServerStatus'

export function McpToolsPanel() {
  const configs = useMcpConfigsStore(state => state.mcpConfigs)
  const connections = useMcpConfigsStore(state => state.connections)
  const statusMap = useMcpConfigsStore(state => state.mcpServerRuningStatusMap)
  const selectedServerName = useMcpConfigsStore(state => state.selectedServerName)

  const config = configs.find(item => item.serverName === selectedServerName)
  if (!config) {
    return (
      <div className="flex h-full min-h-80 items-center justify-center rounded-xl border border-solid border-(--border-color)">
        <EmptyState title="选择服务器查看工具">
          <p className="text-muted-foreground">从左侧列表选择 MCP Server，右侧展示其提供的工具。</p>
        </EmptyState>
      </div>
    )
  }

  const connection = connections.find(item => item.name === selectedServerName)
  const tools = connection?.status === 'connected' ? connection.tools ?? [] : []

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-lg font-medium">{config.serverName}</span>
            <McpServerStatusBadge statusMap={statusMap} serverName={config.serverName} enabled={config.enabled ?? true} />
          </div>
          {
            config.description && <p className="pt-1 text-sm text-muted-foreground">{config.description}</p>
          }
        </div>
        <span className="text-sm text-muted-foreground">
          {tools.length}
          {' '}
          个工具
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-solid border-(--border-color)">
        {
          tools.length > 0
            ? <McpToolList items={tools} />
            : <McpToolsEmpty status={connection?.status ?? 'disconnected'} enabled={config.enabled ?? true} />
        }
      </div>
    </div>
  )
}

function McpToolsEmpty({ status, enabled }: { status: 'connected' | 'connecting' | 'disconnected', enabled: boolean }) {
  const message = status === 'connecting'
    ? '服务器正在启动，连接完成后自动展示工具'
    : status === 'connected'
      ? '服务器已连接，但没有暴露任何工具'
      : enabled
        ? '服务器未运行，开启开关或启动后展示工具'
        : '服务器已禁用，开启开关后启动并展示工具'

  return (
    <div className="flex h-full min-h-60 items-center justify-center">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  )
}

function McpToolList({ items }: { items: McpTool[] }) {
  const [keyword, setKeyword] = useState('')
  const visibleTools = keyword ? items.filter(item => item.name.includes(keyword)) : items

  return (
    <div className="p-3">
      <div className="relative">
        <Input
          value={keyword}
          placeholder="搜索工具"
          onChange={event => setKeyword(event.target.value)}
          className="pl-8"
        />
        <Search className="absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
      </div>
      <div className="mt-3 flex flex-col gap-2">
        {visibleTools.map(tool => <McpToolItem key={tool.name} item={tool} />)}
        {visibleTools.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">没有匹配的工具</p>}
      </div>
    </div>
  )
}

function McpToolItem({ item }: { item: McpTool }) {
  const [expanded, setExpanded] = useState(false)
  const params = Object.entries(item.inputSchema.properties)

  return (
    <div className="rounded-md border border-solid border-(--border-color) bg-card">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
        onClick={() => setExpanded(value => !value)}
      >
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{item.name}</div>
          {
            item.description && <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{item.description}</div>
          }
        </div>
        <ChevronRight className={`size-4 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`} />
      </button>
      {
        expanded && (
          <div className="border-t border-solid border-(--border-color) px-3 py-2">
            {
              params.length === 0
                ? <div className="py-1 text-xs text-muted-foreground">该工具没有参数</div>
                : (
                    <div className="flex flex-col gap-1.5">
                      {params.map(([key, value]) => (
                        <div key={key} className="flex items-baseline gap-2 text-xs">
                          <span className="shrink-0 font-medium">
                            {key}
                            {item.inputSchema.required?.includes(key) ? <span className="text-destructive">*</span> : null}
                          </span>
                          <span className="truncate text-muted-foreground">{String(value.description ?? value.type ?? '')}</span>
                        </div>
                      ))}
                    </div>
                  )
            }
          </div>
        )
      }
    </div>
  )
}
