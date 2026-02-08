import type { AddServiceProviderSchema } from '@ant-chat/shared'
import { PlusOutlined } from '@ant-design/icons'
import { useRequest } from 'ahooks'
import { Button, Form, Input, message, Modal, Select, Switch } from 'antd'
import { nanoid } from 'nanoid'
import React from 'react'
import { providerApi } from '@/api/providerApi'

const { Option } = Select

interface AddCustomProviderProps {
  onAdd: (provider: AddServiceProviderSchema) => Promise<void>
  existingProviderIds?: string[]
  loading?: boolean
}

export function AddCustomProvider({ onAdd, existingProviderIds, loading }: AddCustomProviderProps) {
  const [form] = Form.useForm<AddServiceProviderSchema>()
  const [isModalOpen, setIsModalOpen] = React.useState(false)
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [selectedModelsDevProviderId, setSelectedModelsDevProviderId] = React.useState<string | null>(null)
  const { data: modelsDevProviders, loading: modelsDevLoading, run } = useRequest(
    providerApi.getModelsDevProviders,
    { manual: true },
  )

  const availableModelsDevProviders = React.useMemo(() => {
    if (!modelsDevProviders) {
      return []
    }
    const existingIds = new Set(existingProviderIds || [])
    return modelsDevProviders.filter(provider => !existingIds.has(provider.id))
  }, [modelsDevProviders, existingProviderIds])

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      setIsSubmitting(true)

      const providerData: AddServiceProviderSchema = {
        id: selectedModelsDevProviderId || nanoid(),
        name: values.name,
        baseUrl: values.baseUrl,
        apiKey: values.apiKey,
        apiMode: values.apiMode,
        isEnabled: values.isEnabled ?? true,
      }

      await onAdd(providerData)
      message.success('自定义提供商添加成功')
      setIsModalOpen(false)
      form.resetFields()
      setSelectedModelsDevProviderId(null)
    }
    catch (error) {
      if (error instanceof Error) {
        message.error(`添加失败: ${error.message}`)
      }
      else {
        message.error('添加失败，请重试')
      }
    }
    finally {
      setIsSubmitting(false)
    }
  }

  const handleCancel = () => {
    setIsModalOpen(false)
    form.resetFields()
    setSelectedModelsDevProviderId(null)
  }

  return (
    <>
      <Button
        type="dashed"
        icon={<PlusOutlined />}
        onClick={() => {
          setIsModalOpen(true)
          run()
        }}
        loading={loading}
        className="w-full"
      >
        添加自定义提供商
      </Button>

      <Modal
        title="添加自定义提供商"
        open={isModalOpen}
        onOk={handleSubmit}
        onCancel={handleCancel}
        confirmLoading={isSubmitting}
        okText="添加"
        cancelText="取消"
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            apiMode: 'openai',
            isEnabled: true,
          }}
        >
          <Form.Item
            name="modelsDevProvider"
            label="从 Models.dev 选择"
            help="选择后会自动填充配置，可继续编辑"
          >
            <Select
              placeholder="选择服务商"
              loading={modelsDevLoading}
              allowClear
              showSearch
              optionFilterProp="label"
              onChange={(value) => {
                if (!value) {
                  setSelectedModelsDevProviderId(null)
                  return
                }
                const provider = availableModelsDevProviders.find(item => item.id === value)
                if (!provider) {
                  setSelectedModelsDevProviderId(null)
                  return
                }
                setSelectedModelsDevProviderId(provider.id)
                form.setFieldsValue({
                  name: provider.name,
                  baseUrl: provider.baseUrl,
                  apiMode: provider.apiMode,
                })
              }}
              options={availableModelsDevProviders.map(provider => ({
                label: `${provider.name} (${provider.id})`,
                value: provider.id,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="name"
            label="提供商名称"
            rules={[
              { required: true, message: '请输入提供商名称' },
              { min: 2, message: '名称至少2个字符' },
              { max: 50, message: '名称最多50个字符' },
            ]}
          >
            <Input placeholder="例如：我的自定义 AI" />
          </Form.Item>

          <Form.Item
            name="baseUrl"
            label="API 地址"
            rules={[
              { required: true, message: '请输入API地址' },
              { type: 'url', message: '请输入有效的URL地址' },
            ]}
          >
            <Input placeholder="https://api.example.com" />
          </Form.Item>

          <Form.Item
            name="apiKey"
            label="API Key"
            rules={[
              { required: true, message: '请输入API Key' },
            ]}
          >
            <Input.Password placeholder="输入你的API Key" />
          </Form.Item>

          <Form.Item
            name="apiMode"
            label="API 模式"
            rules={[{ required: true, message: '请选择API模式' }]}
          >
            <Select placeholder="选择API兼容模式">
              <Option value="openai">OpenAI 兼容</Option>
              <Option value="anthropic">Anthropic 兼容</Option>
              <Option value="google">Google 兼容</Option>
            </Select>
          </Form.Item>

          <Form.Item
            name="isEnabled"
            label="启用状态"
          >
            <Switch />
            {/* <Button
              type="text"
              onClick={() => {
                const current = form.getFieldValue('isEnabled')
                form.setFieldValue('isEnabled', !current)
              }}
            >
              {form.getFieldValue('isEnabled') ? '已启用' : '已禁用'}
            </Button> */}
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
