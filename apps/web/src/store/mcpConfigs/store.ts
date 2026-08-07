import type { McpConfigSchema, McpConnection } from '@ant-chat/shared'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

interface McpConfigsState {
  mcpServerRuningStatusMap: Record<string, 'connected' | 'connecting' | 'disconnected'>
  mcpConfigs: McpConfigSchema[]
  /** 已建立连接的 server 及其工具列表，与配置分开存储。 */
  connections: McpConnection[]
  selectedServerName: string | null
}

export const useMcpConfigsStore = create<McpConfigsState>()(
  devtools(
    () => ({
      mcpServerRuningStatusMap: {},
      mcpConfigs: [],
      connections: [],
      selectedServerName: null,
    }),
    {
      enabled: import.meta.env.MODE === 'development',
    },
  ),
)
