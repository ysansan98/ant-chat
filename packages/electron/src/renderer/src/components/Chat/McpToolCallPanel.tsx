import type { IMcpToolCall } from '@ant-chat/shared'
import { LoadingOutlined, PlayCircleOutlined, ReloadOutlined } from '@ant-design/icons'
import { Button, Collapse, Descriptions, Tag } from 'antd'
import React, { Fragment } from 'react'
import ReadMoreContainer from '../ReadMoreContainer'

interface McpToolCallPanelProps {
  item: IMcpToolCall
  onExecute?: (item: IMcpToolCall) => void
}

export function McpToolCallPanel({ item, onExecute }: McpToolCallPanelProps) {
  function getMcpExecuteStateElement() {
    const result: React.ReactNode[] = []
    if (item.executeState === 'await') {
      result.push(
        <Button
          size="small"
          type="primary"
          icon={<PlayCircleOutlined />}
          onClick={(e) => {
            e.stopPropagation()
            onExecute?.(item)
          }}
        >
          执行
        </Button>,
      )
    }
    else if (item.executeState === 'executing') {
      result.push(<LoadingOutlined spin />)
    }
    else if (item.executeState === 'completed' && item.result?.success) {
      result.push(<Tag color="green">执行成功</Tag>)
    }
    else if (item.executeState === 'completed' && !item.result?.success) {
      result.push(
        <>
          <Tag color="red">执行失败</Tag>
        </>,
      )
    }

    if (item.executeState !== 'executing') {
      result.push(
        <Button
          size="small"
          title="重试"
          type="text"
          icon={<ReloadOutlined />}
          onClick={(e) => {
            e.stopPropagation()
            onExecute?.(item)
          }}
        />,
      )
    }

    return result
  }

  return (
    <Collapse
      size="small"
      items={[
        {
          key: 'mcp',
          label: (
            <div className="flex w-full justify-between">
              <div className="flex items-center">
                MCP：
                <Tag color="blue">{item.serverName}</Tag>
                <Tag color="green">{item.toolName}</Tag>
              </div>
              <div className="ml-5">
                {getMcpExecuteStateElement().map((el, index) => (
                  <Fragment key={index}>
                    {el}
                  </Fragment>
                ))}
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
