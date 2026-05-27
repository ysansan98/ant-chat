import type { McpConfigSchema } from '@ant-chat/shared'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

interface McpConfigsState {
  mcpServerRuningStatusMap: Record<string, 'connected' | 'connecting' | 'disconnected'>
  mcpConfigs: McpConfigSchema[]
}

export const useMcpConfigsStore = create<McpConfigsState>()(
  devtools(
    () => ({
      mcpServerRuningStatusMap: {},
      mcpConfigs: [],
    }),
    {
      enabled: import.meta.env.MODE === 'development',
    },
  ),
)
