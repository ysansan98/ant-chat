import type { AgentPendingAction } from '@ant-chat/shared'

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
    <div className="mb-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs">
      <div className="font-medium">
        审批请求：
        {pending.toolName}
        {' '}
        (
        {pending.riskLevel}
        )
      </div>
      <div className="mt-1 break-all text-gray-600">{pending.inputPreview}</div>
      <div className="mt-2 flex gap-2">
        <button type="button" className="rounded-sm bg-emerald-600 px-2 py-1 text-white" onClick={onApprove}>批准</button>
        <button type="button" className="rounded-sm bg-red-600 px-2 py-1 text-white" onClick={onReject}>拒绝</button>
      </div>
    </div>
  )
}
