import type { AgentPendingAction } from '@ant-chat/shared'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/card'

const scopeLabels: Record<string, string> = {
  workspace: '工作区内',
  outside: '跨工作区',
  blocked: '已拦截',
}

const typeLabels: Record<string, string> = {
  read: '读取',
  write: '写入',
  bash: '命令',
  skill: '技能',
}

export default function AgentApprovalCard({
  pending,
  onApprove,
  onReject,
}: {
  pending: AgentPendingAction
  onApprove: () => void
  onReject: () => void
}) {
  const scopeLabel = scopeLabels[pending.scope] || pending.scope
  const typeLabel = typeLabels[pending.operationType] || pending.operationType

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
      <div className="flex gap-2 px-3 pb-3">
        <Button size="xs" data-testid="agent-approve" onClick={onApprove}>
          批准
        </Button>
        <Button size="xs" data-testid="agent-reject" variant="destructive" onClick={onReject}>
          拒绝
        </Button>
      </div>
    </Card>
  )
}
