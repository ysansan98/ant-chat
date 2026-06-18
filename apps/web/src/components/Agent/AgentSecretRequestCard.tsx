import type { SecretRequest } from '@ant-chat/shared'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Input } from '@workspace/ui/components/input'
import { Label } from '@workspace/ui/components/label'
import { KeyRoundIcon } from 'lucide-react'
import { useState } from 'react'

export default function AgentSecretRequestCard({
  request,
  onSubmit,
  onReject,
}: {
  request: SecretRequest
  onSubmit: (values: Record<string, string>) => void
  onReject: () => void
}) {
  const [values, setValues] = useState<Record<string, string>>({})
  const canSubmit = request.fields.every(field => values[field.key])

  function submit() {
    if (canSubmit) {
      onSubmit(values)
    }
  }

  return (
    <Card size="sm" className="mb-2 text-xs" data-testid="agent-secret-request-card">
      <CardHeader>
        <CardTitle className="gap-1 text-xs">
          <KeyRoundIcon className="size-3.5" />
          敏感信息请求：
          {request.label}
        </CardTitle>
      </CardHeader>
      {request.reason && (
        <CardContent className="text-muted-foreground">
          {request.reason}
        </CardContent>
      )}
      <div className="space-y-2 px-3 pb-3">
        <Label className="text-xs">
          输入内容不会发送给模型，仅在当前任务内存中使用
        </Label>
        {request.fields.map(field => (
          <div key={field.key} className="space-y-1">
            <Label htmlFor={`secret-request-${request.requestId}-${field.key}`} className="text-xs text-muted-foreground">
              {field.label}
            </Label>
            <Input
              id={`secret-request-${request.requestId}-${field.key}`}
              type="password"
              value={values[field.key] ?? ''}
              autoComplete="off"
              onChange={event => setValues(current => ({ ...current, [field.key]: event.target.value }))}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  submit()
                }
              }}
            />
          </div>
        ))}
        <div className="flex gap-2">
          <Button size="xs" disabled={!canSubmit} onClick={submit}>
            提交
          </Button>
          <Button size="xs" variant="destructive" onClick={onReject}>
            拒绝
          </Button>
        </div>
      </div>
    </Card>
  )
}
