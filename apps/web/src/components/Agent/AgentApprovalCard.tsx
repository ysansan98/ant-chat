import type { AgentPendingAction } from '@ant-chat/shared'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Label } from '@workspace/ui/components/label'
import { Switch } from '@workspace/ui/components/switch'
import { useState } from 'react'

const scopeLabels: Record<string, string> = {
  workspace: '工作区内',
  outside: '跨工作区',
  external: '外部服务',
  blocked: '已拦截',
}

const typeLabels: Record<string, string> = {
  read: '读取',
  write: '写入',
  bash: '命令',
  bash_read: '只读命令',
  browser: '浏览器',
  skill: '技能',
  mcp: 'MCP 工具',
}

export default function AgentApprovalCard({
  pending,
  onApprove,
  onReject,
}: {
  pending: AgentPendingAction
  onApprove: (remember?: 'workspace' | 'global') => void
  onReject: () => void
}) {
  const [remember, setRemember] = useState(false)
  const [isGlobal, setIsGlobal] = useState(false)
  const scopeLabel = scopeLabels[pending.scope] || pending.scope
  const typeLabel = typeLabels[pending.operationType] || pending.operationType
  const patternText = pending.approvalGrant
    ? pending.approvalGrant.description
    : ''

  return (
    <Card size="sm" className="mb-2 text-xs" data-testid="agent-approval-card">
      <CardHeader>
        <CardTitle className="gap-1 text-xs">
          审批请求：
          {pending.toolName}
          <Badge variant="secondary">{typeLabel}</Badge>
          {pending.scope !== 'workspace' && (
            <Badge variant="outline">{scopeLabel}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="break-all text-muted-foreground">
        {pending.inputPreview}
      </CardContent>
      {pending.approvalGrant && (
        <div className="flex items-center gap-2 px-3 pb-1">
          <Switch
            id="remember-whitelist"
            size="sm"
            checked={remember}
            onCheckedChange={val => setRemember(Boolean(val))}
            data-testid="agent-whitelist-toggle"
          />
          <Label htmlFor="remember-whitelist" className="cursor-pointer text-xs">
            记住此授权
          </Label>
        </div>
      )}
      {remember && pending.approvalGrant && (
        <div className="space-y-2 px-3 pb-2">
          <div className="
            rounded-md border bg-muted/20 p-2 text-center font-mono text-xs text-muted-foreground
          "
          >
            {patternText}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">生效范围</span>
            <Badge
              variant={isGlobal ? 'default' : 'outline'}
              className="cursor-pointer text-xs"
              data-testid="agent-whitelist-scope-global"
              onClick={() => setIsGlobal(true)}
            >
              全局
            </Badge>
            <Badge
              variant={!isGlobal ? 'default' : 'outline'}
              className="cursor-pointer text-xs"
              data-testid="agent-whitelist-scope-workspace"
              onClick={() => setIsGlobal(false)}
            >
              当前工作区
            </Badge>
          </div>
        </div>
      )}
      <div className="flex gap-2 px-3 pb-3">
        <Button
          size="xs"
          data-testid="agent-approve"
          onClick={() => onApprove(remember ? (isGlobal ? 'global' : 'workspace') : undefined)}
        >
          批准
        </Button>
        <Button size="xs" data-testid="agent-reject" variant="destructive" onClick={onReject}>
          拒绝
        </Button>
      </div>
    </Card>
  )
}
