import type { McpConfigSchema, McpServerStatus } from '@ant-chat/shared'
import { DeleteOutlined, EditOutlined, PauseCircleOutlined, PlayCircleOutlined } from '@ant-design/icons'
import { Button, Popconfirm } from 'antd'

export interface McpConfigActionsProps {
  item: McpConfigSchema
  status: McpServerStatus
  onTriggerAction?: (action: 'start' | 'stop' | 'edit' | 'delete', item: McpConfigSchema) => void | Promise<void>
}

export function McpConfigActions({ item, status, onTriggerAction }: McpConfigActionsProps) {
  return (
    <div className="flex items-center gap-2">
      {
        status === 'connected' && (
          <Button
            icon={<PauseCircleOutlined />}
            title="停止"
            onClick={() => {
              onTriggerAction?.('stop', item)
            }}
          />
        )
      }
      {
        status === 'disconnected' && (
          <Button
            icon={<PlayCircleOutlined />}
            title="启动"
            onClick={() => {
              onTriggerAction?.('start', item)
            }}
          />
        )
      }
      <Button
        icon={<EditOutlined />}
        title="编辑"
        onClick={() => {
          onTriggerAction?.('edit', item)
        }}
      />
      {
        status === 'disconnected' && (
          <Popconfirm
            title={`删除${item.serverName}服务器`}
            description="删除后将无法使用该服务器"
            okButtonProps={{ danger: true }}
            onConfirm={async () => {
              await onTriggerAction?.('delete', item)
            }}
          >
            <Button
              icon={<DeleteOutlined />}
              title="删除"
            />
          </Popconfirm>
        )
      }
    </div>
  )
}
