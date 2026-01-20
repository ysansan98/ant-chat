import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons'
import { Button, Form, Input } from 'antd'
import React from 'react'

interface KeyValueListProps {
  name: string | number | (string | number)[]
  label?: React.ReactNode
  keyPlaceholder?: string
  valuePlaceholder?: string
  keyRequired?: boolean
  valueRequired?: boolean
  keyRules?: any[]
  valueRules?: any[]
  addButtonLabel?: string
  disabled?: boolean
}

export function KeyValueList({
  name,
  label,
  keyPlaceholder = '键',
  valuePlaceholder = '值',
  keyRequired = true,
  valueRequired = true,
  keyRules,
  valueRules,
  addButtonLabel = '添加',
  disabled = false,
}: KeyValueListProps) {
  const defaultKeyRules = keyRequired ? [{ required: true, message: `请输入${keyPlaceholder}` }] : []
  const defaultValueRules = valueRequired ? [{ required: true, message: `请输入${valuePlaceholder}` }] : []

  return (
    <Form.Item label={label}>
      <Form.List name={name}>
        {(fields, { add, remove }) => (
          <>
            {fields.map(({ key, name }) => (
              <div key={key} className="mb-4 flex w-full items-center gap-3">
                <Form.Item
                  className="!mb-0 flex-1"
                  name={[name, 'key']}
                  rules={[...defaultKeyRules, ...(keyRules || [])]}
                >
                  <Input placeholder={keyPlaceholder} disabled={disabled} />
                </Form.Item>
                <Form.Item
                  name={[name, 'value']}
                  rules={[...defaultValueRules, ...(valueRules || [])]}
                  className="!mb-0 flex-1"
                >
                  <Input placeholder={valuePlaceholder} disabled={disabled} />
                </Form.Item>
                {!disabled && (
                  <MinusCircleOutlined className="ml-2" onClick={() => remove(name)} />
                )}
              </div>
            ))}
            <Form.Item className="!mb-0">
              <Button
                type="dashed"
                onClick={() => add({ key: '', value: '' })}
                block
                icon={<PlusOutlined />}
                disabled={disabled}
              >
                {addButtonLabel}
              </Button>
            </Form.Item>
          </>
        )}
      </Form.List>
    </Form.Item>
  )
}
