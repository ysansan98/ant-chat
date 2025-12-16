import type { IMcpToolCall } from '@ant-chat/shared'
import { LoadingOutlined, PlayCircleOutlined, ReloadOutlined } from '@ant-design/icons'
import { Button, Collapse, Descriptions, Tag } from 'antd'
import ReadMoreContainer from '../ReadMoreContainer'

interface McpToolCallPanelProps {
  item: IMcpToolCall
  onExecute?: (item: IMcpToolCall) => void
}

export function McpToolCallPanel({ item, onExecute }: McpToolCallPanelProps) {
  function getMcpExecuteStateElement() {
    const handleExecute = (e: React.MouseEvent) => {
      e.stopPropagation()
      onExecute?.(item)
    }

    return (
      <div className="flex items-center gap-2">
        {item.executeState === 'await' && (
          <Button
            size="small"
            type="primary"
            icon={<PlayCircleOutlined />}
            onClick={handleExecute}
          >
            执行
          </Button>
        )}

        {item.executeState === 'executing' && (
          <LoadingOutlined spin />
        )}

        {item.executeState === 'completed' && item.result?.success && (
          <>
            <Tag color="green">执行成功</Tag>
            <Button
              size="small"
              title="重试"
              type="text"
              icon={<ReloadOutlined />}
              onClick={handleExecute}
            />
          </>
        )}

        {item.executeState === 'completed' && !item.result?.success && (
          <>
            <Tag color="red">执行失败</Tag>
            <Button
              size="small"
              title="重试"
              type="text"
              icon={<ReloadOutlined />}
              onClick={handleExecute}
            />
          </>
        )}
      </div>
    )
  }

  return (
    <Collapse
      size="small"
      items={[
        {
          key: 'mcp',
          label: (
            <div className="flex w-full justify-between">
              <div className="flex items-center gap-1">
                MCP：
                <Tag color="blue">{item.serverName}</Tag>
                <Tag color="green">{item.toolName}</Tag>
              </div>
              <div className="ml-5">
                {getMcpExecuteStateElement()}
              </div>
            </div>
          ),
          children: (
            <Descriptions
              items={[
                {
                  key: 'arguments',
                  label: '执行参数',
                  span: 'filled',
                  children: (
                    <div className="whitespace-pre-wrap">
                      <ReadMoreContainer maxHeight={300}>
                        {JSON.stringify(item.args, null, 2)}
                      </ReadMoreContainer>
                    </div>
                  ),
                },
                {
                  key: 'result',
                  label: '执行结果',
                  span: 'filled',
                  children: (
                    <div className={`
                      w-full whitespace-pre-wrap
                      ${!item.result?.success && 'text-red-500'}
                    `}
                    >
                      <ReadMoreContainer maxHeight={300}>
                        {
                          item.result?.success
                            ? item.result?.data
                            : item.result?.error
                        }
                      </ReadMoreContainer>

                    </div>
                  ),
                },
              ]}
            />

          ),
        },
      ]}
    />
  )
}
