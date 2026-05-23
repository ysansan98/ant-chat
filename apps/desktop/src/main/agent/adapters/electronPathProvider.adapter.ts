import type { IAgentPathProvider } from '@ant-chat/shared'
import { getAgentLogsDir } from '@main/utils/appPaths'

export const electronPathProvider: IAgentPathProvider = {
  getLogsDir: getAgentLogsDir,
}
