import path from 'node:path'

export interface AppRuntimePaths {
  root: string
  databaseFile: string
  settingsFile: string
  mcpSettingsFile: string
  memoryRoot: string
  /** 长期记忆目录（人工批准的结论层）：memories/<workspace-key>/<memory-id>.md */
  memoriesRoot: string
  workspaceSettingsFile: string
  attachmentsRoot: string
  skillsRoot: string
  logsRoot: string
  observabilityRoot: string
  permissionsFile: string
}

export function createAppRuntimePaths(root: string): AppRuntimePaths {
  const logsRoot = path.join(root, 'logs')

  return {
    root,
    databaseFile: path.join(root, 'ant-chat.db'),
    settingsFile: path.join(root, 'settings.json'),
    mcpSettingsFile: path.join(root, 'mcp.json'),
    memoryRoot: path.join(root, 'agent-memory'),
    memoriesRoot: path.join(root, 'memories'),
    workspaceSettingsFile: path.join(root, 'workspace.json'),
    attachmentsRoot: path.join(root, 'attachments'),
    skillsRoot: path.join(root, 'skills'),
    logsRoot,
    observabilityRoot: path.join(logsRoot, 'observability'),
    permissionsFile: path.join(root, 'permissions.json'),
  }
}
