import path from 'node:path'

export interface AgentRuntimePaths {
  root: string
  databaseFile: string
  settingsFile: string
  mcpSettingsFile: string
  profileRoot: string
  workspaceSettingsFile: string
  skillsRoot: string
  logsRoot: string
  taskLogsRoot: string
}

export function createAgentRuntimePaths(root: string): AgentRuntimePaths {
  const logsRoot = path.join(root, 'logs')

  return {
    root,
    databaseFile: path.join(root, 'ant-chat.db'),
    settingsFile: path.join(root, 'settings.json'),
    mcpSettingsFile: path.join(root, 'mcp.json'),
    profileRoot: path.join(root, 'agent-profile'),
    workspaceSettingsFile: path.join(root, 'workspace.json'),
    skillsRoot: path.join(root, 'skills'),
    logsRoot,
    taskLogsRoot: path.join(logsRoot, 'tasks'),
  }
}
