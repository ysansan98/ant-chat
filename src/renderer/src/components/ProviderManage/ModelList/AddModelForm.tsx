import type { AddServiceProviderModelSchema } from '@ant-chat/shared'
import { Form, Input, InputNumber, Modal } from 'antd'

type AddModelForm = Omit<AddServiceProviderModelSchema, 'providerServiceId'>

interface AddModelFormModalProps {
  open: boolean
  title: string
  onClose?: () => void
  onCancel?: () => void
  onSave?: (data: AddModelForm) => void
}

export function AddModelFormModal({ open, title, onCancel, onSave }: AddModelFormModalProps) {
  const [form] = Form.useForm<AddModelForm>()

  return (
    <Modal
      open={open}
      title={title}
      onCancel={() => onCancel?.()}
      onOk={() => {
        form.validateFields().then((value) => {
          onSave?.(value)
          form.resetFields()
        })
      }}
    >
      <Form
        form={form}
        layout="vertical"
        className="!pt-3"
        initialValues={{
          temperature: 0.7,
        }}
      >
        <Form.Item required label="模型" name="model">
          <Input />
        </Form.Item>
        <Form.Item required label="模型名称" name="name">
          <Input />
        </Form.Item>

        <Form.Item required label="默认temperature" name="temperature">
          <InputNumber step={0.1} min={0} max={2} style={{ width: '100%' }} />
        </Form.Item>

        <Form.Item required label="最大tokens" name="maxTokens">
          <InputNumber min={1000} step={1000} style={{ width: '100%' }} />
        </Form.Item>

        <Form.Item required label="最大上下文" name="contextLength">
          <InputNumber min={1000} step={1000} style={{ width: '100%' }} />
        </Form.Item>
      </Form>
    </Modal>
  )
}
