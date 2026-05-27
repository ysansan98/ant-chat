import { createAgentRuntime } from '@ant-chat/agent-core'
import { createDesktopAgentHost } from './desktopAgentHost'

export function createDesktopAgentRuntime() {
  return createAgentRuntime({
    host: createDesktopAgentHost(),
  })
}
