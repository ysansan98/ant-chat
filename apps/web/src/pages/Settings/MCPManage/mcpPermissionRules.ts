import type { ToolApprovalRule } from '@ant-chat/shared'

interface PermissionRuleGroups {
  global: ToolApprovalRule[]
  workspaces: Record<string, ToolApprovalRule[]>
}

export function countMcpRules(permissions: PermissionRuleGroups, serverName: string): number {
  return [permissions.global, ...Object.values(permissions.workspaces)]
    .flat()
    .filter(rule => rule.kind === 'mcp-tool' && rule.serverName === serverName)
    .length
}
