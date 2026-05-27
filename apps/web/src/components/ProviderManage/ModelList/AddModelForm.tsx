import type { AddServiceProviderModelSchema } from '@ant-chat/shared'
import { Button } from '@workspace/ui/components/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@workspace/ui/components/dialog'
import { Input } from '@workspace/ui/components/input'
import { InputNumber } from '@workspace/ui/components/input-number'
import { Switch } from '@workspace/ui/components/switch'
import React from 'react'

type AddModelForm = Omit<AddServiceProviderModelSchema, 'providerServiceId'>

interface AddModelFormModalProps {
  open: boolean
  title: string
  onClose?: () => void
  onCancel?: () => void
  onSave?: (data: AddModelForm) => void
}

export function AddModelFormModal({ open, title, onCancel, onSave }: AddModelFormModalProps) {
  const [model, setModel] = React.useState('')
  const [name, setName] = React.useState('')
  const [temperature, setTemperature] = React.useState(0.7)
  const [maxTokens, setMaxTokens] = React.useState<number | undefined>()
  const [contextLength, setContextLength] = React.useState<number | undefined>()
  const [functionCall, setFunctionCall] = React.useState(false)
  const [reasoning, setReasoning] = React.useState(false)
  const [vision, setVision] = React.useState(false)

  const handleClose = () => {
    onCancel?.()
  }

  const resetFields = () => {
    setModel('')
    setName('')
    setTemperature(0.7)
    setMaxTokens(undefined)
    setContextLength(undefined)
    setFunctionCall(false)
    setReasoning(false)
    setVision(false)
  }

  const handleSave = () => {
    onSave?.({
      model,
      name,
      temperature,
      maxTokens: maxTokens || 4000,
      contextLength: contextLength || 4000,
      modelFeatures: {
        functionCall,
        reasoning,
        vision,
      },
    } as AddModelForm)
    resetFields()
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 pt-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="model-id" className="text-sm font-medium">模型</label>
            <Input id="model-id" value={model} onChange={e => setModel(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="model-name" className="text-sm font-medium">模型名称</label>
            <Input id="model-name" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="model-temperature" className="text-sm font-medium">默认temperature</label>
            <InputNumber
              id="model-temperature"
              step={0.1}
              min={0}
              max={2}
              className="w-full"
              value={temperature}
              onChange={e => setTemperature(Number(e.target.value))}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="model-max-tokens" className="text-sm font-medium">最大tokens</label>
            <InputNumber
              id="model-max-tokens"
              min={1000}
              step={1000}
              className="w-full"
              value={maxTokens ?? ''}
              onChange={e => setMaxTokens(Number(e.target.value) || undefined)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="model-context-length" className="text-sm font-medium">最大上下文</label>
            <InputNumber
              id="model-context-length"
              min={1000}
              step={1000}
              className="w-full"
              value={contextLength ?? ''}
              onChange={e => setContextLength(Number(e.target.value) || undefined)}
            />
          </div>
          <div className="flex items-center justify-between">
            <label htmlFor="model-function-call" className="text-sm font-medium">函数调用</label>
            <Switch id="model-function-call" checked={functionCall} onCheckedChange={setFunctionCall} />
          </div>
          <div className="flex items-center justify-between">
            <label htmlFor="model-reasoning" className="text-sm font-medium">推理</label>
            <Switch id="model-reasoning" checked={reasoning} onCheckedChange={setReasoning} />
          </div>
          <div className="flex items-center justify-between">
            <label htmlFor="model-vision" className="text-sm font-medium">视觉</label>
            <Switch id="model-vision" checked={vision} onCheckedChange={setVision} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose}>取消</Button>
            <Button type="button" onClick={handleSave}>确认</Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}
