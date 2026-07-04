import { Switch } from '@workspace/ui/components/switch'
import React from 'react'
import { setEnableMCP, useChatSttingsStore } from '@/store/chatSettings'
import { connectMcpServerAction, disconnectMcpServerAction, initializeMcpConfigs, useMcpConfigsStore } from '@/store/mcpConfigs'

export function MCPManagementPanel() {
  const MCPEnabled = useChatSttingsStore(state => state.enableMCP)
  const mcpConfigs = useMcpConfigsStore(state => state.mcpConfigs)
  const mcpServerRuningStatusMap = useMcpConfigsStore(state => state.mcpServerRuningStatusMap)

  React.useEffect(() => {
    if (MCPEnabled) {
      initializeMcpConfigs()
    }
  }, [MCPEnabled])

  return (
    <div className="min-w-80">
      <div className="flex items-center justify-between p-2">
        <div>
          启用MCP
          <div className="text-xs text-muted-foreground">
            启用MCP功能以使用工具调用
          </div>
        </div>
        <Switch checked={MCPEnabled} onCheckedChange={setEnableMCP} />
      </div>
      {
        MCPEnabled && mcpConfigs.length
          ? (
              <div>
                <div className="my-3 h-px bg-(--border-color)"></div>
                <div className="flex max-h-80 flex-col overflow-y-auto">
                  {
                    mcpConfigs.map(item => (
                      <div className="flex items-center justify-between py-1" key={item.serverName}>
                        <div className="flex items-center gap-2">
                          <span>{item.icon}</span>
                          <span>{item.serverName}</span>
                        </div>
                        <div>
                          <Switch
                            size="sm"
                            disabled={mcpServerRuningStatusMap[item.serverName] === 'connecting'}
                            checked={mcpServerRuningStatusMap[item.serverName] === 'connected'}
                            onCheckedChange={() => {
                              if (mcpServerRuningStatusMap[item.serverName] === 'connected') {
                                disconnectMcpServerAction(item.serverName)
                              }
                              else {
                                connectMcpServerAction(item.serverName)
                              }
                            }}
                          />
                        </div>
                      </div>
                    ))
                  }
                </div>
              </div>
            )
          : null
      }
    </div>
  )
}
