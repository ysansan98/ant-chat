import type { AgentPendingAction } from '@ant-chat/shared'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/card'

export default function AgentApprovalCard({
  pending,
  onApprove,
  onReject,
}: {
  pending: AgentPendingAction
  onApprove: () => void
  onReject: () => void
}) {
  return (
    <Card size="sm" className="mb-2 text-xs">
      <CardHeader>
        <CardTitle className="gap-1 text-xs">
          审批请求：
          {pending.toolName}
          <Badge variant="secondary">{pending.riskLevel}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="text-muted-foreground break-all">
        {pending.inputPreview}
      </CardContent>
      <div className="flex gap-2 px-3 pb-3">
        <Button size="xs" onClick={onApprove}>
          批准
        </Button>
        <Button size="xs" variant="destructive" onClick={onReject}>
          拒绝
        </Button>
      </div>
    </Card>
  )
}
