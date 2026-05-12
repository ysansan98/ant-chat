import type { IAgentPathProvider } from '@ant-chat/shared'
import { getAgentLogsDir, getAgentTasksDir } from '@main/utils/appPaths'

export const electronPathProvider: IAgentPathProvider = {
  getCheckpointsDir: getAgentTasksDir,
  getLogsDir: getAgentLogsDir,
}
