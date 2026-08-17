import type { CreateProviderConfigModelSchema, ReasoningEffortLevel } from '@ant-chat/shared'
import { Button } from '@workspace/ui/components/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@workspace/ui/components/dialog'
import { Input } from '@workspace/ui/components/input'
import { InputNumber } from '@workspace/ui/components/input-number'
import { Switch } from '@workspace/ui/components/switch'
import React from 'react'

type AddModelForm = Omit<CreateProviderConfigModelSchema, 'providerId'>

const INPUT_MODALITY_OPTIONS = [
  { value: 'text', label: '文本' },
  { value: 'image', label: '图片' },
  { value: 'pdf', label: 'PDF' },
  { value: 'video', label: '视频' },
  { value: 'audio', label: '音频' },
] as const

// 与 ModelSelect 的推理强度文案保持一致；provider-default 是运行时默认值，不属于模型能力档位。
const REASONING_EFFORT_OPTIONS: { value: ReasoningEffortLevel, label: string }[] = [
  { value: 'none', label: '关闭' },
  { value: 'minimal', label: '极简' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'xhigh', label: '极高' },
]

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
  const [maxOutputTokens, setMaxOutputTokens] = React.useState<number | undefined>()
  const [contextLength, setContextLength] = React.useState<number | undefined>()
  const [functionCall, setFunctionCall] = React.useState(false)
  const [reasoning, setReasoning] = React.useState(false)
  const [reasoningLevels, setReasoningLevels] = React.useState<Set<ReasoningEffortLevel>>(new Set())
  const [inputModalities, setInputModalities] = React.useState<Set<string>>(new Set(['text']))
  const [prevOpen, setPrevOpen] = React.useState(open)

  // 弹窗关闭（取消/X/ESC/父组件置 false）时清空表单，避免下次打开残留数据；
  // 组件复用不卸载，因此在渲染期对比 open 变化（与 ProviderSettingsPanel 同模式）。
  // resetFields 用函数声明以便提升，可在渲染期安全调用。
  if (prevOpen !== open) {
    setPrevOpen(open)
    if (!open) {
      resetFields()
    }
  }

  function resetFields() {
    setModel('')
    setName('')
    setMaxOutputTokens(undefined)
    setContextLength(undefined)
    setFunctionCall(false)
    setReasoning(false)
    setReasoningLevels(new Set())
    setInputModalities(new Set(['text']))
  }

  const handleClose = () => {
    onCancel?.()
  }

  const toggleModality = (modality: string, checked: boolean) => {
    setInputModalities((prev) => {
      const next = new Set(prev)
      if (checked) {
        next.add(modality)
      }
      else {
        next.delete(modality)
      }
      return next
    })
  }

  const toggleReasoningLevel = (level: ReasoningEffortLevel, checked: boolean) => {
    setReasoningLevels((prev) => {
      const next = new Set(prev)
      if (checked) {
        next.add(level)
      }
      else {
        next.delete(level)
      }
      return next
    })
  }

  const hasInputModalities = inputModalities.size > 0
  const hasFeatures = functionCall || reasoning || hasInputModalities

  const handleSave = () => {
    onSave?.({
      model,
      name,
      // temperature 不再在表单中暴露，保存默认值。
      temperature: 0.7,
      maxOutputTokens: maxOutputTokens ?? 4000,
      contextLength: contextLength || 4000,
      capabilities: hasFeatures
        ? {
            functionCall: functionCall || undefined,
            reasoning: reasoning || undefined,
            reasoningLevels: reasoningLevels.size > 0 ? Array.from(reasoningLevels) : undefined,
            inputModalities: hasInputModalities ? Array.from(inputModalities) as ('text' | 'image' | 'pdf' | 'video' | 'audio')[] : undefined,
          }
        : undefined,
    } as AddModelForm)
    // 不在保存时清空：保存失败时保留用户输入；关闭弹窗时统一 resetFields。
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4 pt-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="model-id" className="text-sm font-medium">模型</label>
            <Input id="model-id" className="h-7" value={model} onChange={e => setModel(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="model-name" className="text-sm font-medium">模型名称</label>
            <Input id="model-name" className="h-7" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="model-max-output-tokens" className="text-sm font-medium">最大输出 Token</label>
            <InputNumber
              id="model-max-output-tokens"
              min={1000}
              step={1000}
              className="h-7 w-full"
              value={maxOutputTokens ?? ''}
              onChange={e => setMaxOutputTokens(Number(e.target.value) || undefined)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="model-context-length" className="text-sm font-medium">最大上下文</label>
            <InputNumber
              id="model-context-length"
              min={1000}
              step={1000}
              className="h-7 w-full"
              value={contextLength ?? ''}
              onChange={e => setContextLength(Number(e.target.value) || undefined)}
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <label htmlFor="model-function-call" className="text-sm font-medium">工具调用</label>
            <Switch id="model-function-call" checked={functionCall} onCheckedChange={setFunctionCall} />
          </div>
          <div className="flex items-center justify-between gap-4">
            <label htmlFor="model-reasoning" className="text-sm font-medium">推理</label>
            <Switch id="model-reasoning" checked={reasoning} onCheckedChange={setReasoning} />
          </div>
          {reasoning && (
            <div className="col-span-2 flex items-center justify-between gap-4">
              <span className="shrink-0 text-sm font-medium">推理强度</span>
              <div className="flex flex-wrap justify-end gap-1.5">
                {REASONING_EFFORT_OPTIONS.map(opt => (
                  <Button
                    key={opt.value}
                    type="button"
                    size="xs"
                    variant={reasoningLevels.has(opt.value) ? 'default' : 'outline'}
                    aria-pressed={reasoningLevels.has(opt.value)}
                    aria-label={`推理强度 ${opt.label}`}
                    onClick={() => toggleReasoningLevel(opt.value, !reasoningLevels.has(opt.value))}
                  >
                    {opt.label}
                  </Button>
                ))}
              </div>
            </div>
          )}
          <div className="col-span-2 flex items-center justify-between gap-4">
            <span className="shrink-0 text-sm font-medium">支持输入类型</span>
            <div className="flex flex-wrap justify-end gap-1.5">
              {INPUT_MODALITY_OPTIONS.map(opt => (
                <Button
                  key={opt.value}
                  type="button"
                  size="xs"
                  variant={inputModalities.has(opt.value) ? 'default' : 'outline'}
                  aria-pressed={inputModalities.has(opt.value)}
                  aria-label={`输入类型 ${opt.label}`}
                  onClick={() => toggleModality(opt.value, !inputModalities.has(opt.value))}
                >
                  {opt.label}
                </Button>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={handleClose}>取消</Button>
          <Button type="button" onClick={handleSave}>确认</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
