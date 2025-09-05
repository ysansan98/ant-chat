import { CheckCircleOutlined, DeleteOutlined, MinusCircleOutlined, PlusCircleOutlined } from '@ant-design/icons'
import { useRequest } from 'ahooks'
import { App, Button, Empty } from 'antd'
import React from 'react'
import { dbApi } from '@/api/dbApi'
import { AddModelFormModal } from './AddModelForm'

export interface ModelListProps {
  serviceProviderId: string
}

export function ModelList({ serviceProviderId }: ModelListProps) {
  const { message } = App.useApp()
  const [openAddModal, setAddModal] = React.useState(false)
  const { data, error, refresh, run, mutate } = useRequest(dbApi.getModelsByServiceProviderId, {
    defaultParams: [serviceProviderId],
  })

  React.useEffect(() => {
    run(serviceProviderId)
  }, [serviceProviderId])

  if (error) {
    return (
      <Empty description={error.message}>
        <Button>重试</Button>
      </Empty>
    )
  }

  return (
    <div className="py-2">
      <Button
        size="small"
        icon={<PlusCircleOutlined />}
        onClick={() => {
          setAddModal(true)
        }}
      >
        添加模型
      </Button>
      <div className="mt-2 flex flex-col rounded-md border border-(--ant-color-border)">
        {
          data?.map(item => (
            <div
              key={item.id}
              className={`
                flex items-center justify-between border-b border-(--ant-color-border) px-3 py-2
                last:border-0
              `}
            >
              <div className="flex items-center gap-1">
                {item.name}
              </div>

              <div className="flex items-center gap-2">
                {
                  item.isBuiltin
                    ? 'default'
                    : (
                        <Button
                          type="text"
                          danger
                          icon={<DeleteOutlined />}
                        />
                      )
                }
                <Button
                  type="text"
                  size="small"
                  icon={item.isEnabled
                    ? (
                        <CheckCircleOutlined className="!text-(--ant-color-success)" />
                      )
                    : (
                        <MinusCircleOutlined className="!text-(--ant-color-error)" />
                      )}
                  onClick={async () => {
                    await dbApi.setModelEnabledStatus(item.id, !item.isEnabled)
                    refresh()
                  }}
                />
              </div>
            </div>
          ))
        }
      </div>

      <AddModelFormModal
        open={openAddModal}
        title="添加模型"
        onCancel={() => setAddModal(false)}
        onClose={() => setAddModal(false)}
        onSave={async (e) => {
          dbApi.addServiceProviderModel({
            ...e,
            serviceProviderId,
          }).then(
            (modelInfo) => {
              setAddModal(false)
              mutate([modelInfo, ...(data ?? [])])
            },
            (err: Error) => {
              message.error(err.message)
            },
          )
        }}
      />
    </div>
  )
}
