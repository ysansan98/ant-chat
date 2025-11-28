import type { McpConfigSchema, McpTool } from '@ant-chat/shared'
import type { RuleObject } from 'antd/es/form'
import { AddMcpConfigSchema, UpdateMcpConfigSchema } from '@ant-chat/shared'

import { RightOutlined } from '@ant-design/icons'
import { Alert, Avatar, Button, Descriptions, Drawer, Empty, Form, Input, Select, Tag } from 'antd'
import React from 'react'
import { useImmer } from 'use-immer'
import { dbApi } from '@/api/dbApi'
import { connectMcpServer, fetchMcpServerTools } from '@/api/mcpApi'
import { KeyValueList } from '@/components/Common/KeyValueList'
import { EmojiPickerHoc } from '@/components/EmojiPiker'
import { QuickImport } from './QuickImport'
import { SelectTransportType } from './SelectTransportType'

interface McpConfigDrawerProps {
  open: boolean
  mode: 'add' | 'edit'
  defaultValues?: McpConfigSchema
  onClose?: () => void
  onSave?: (config: AddMcpConfigSchema | UpdateMcpConfigSchema) => void
}

interface McpConfigForm {
  serverName: string
  icon: string
  transportType: 'stdio' | 'sse'
  command?: string
  args?: string[]
  env?: { key: string, value: string }[]
  headers?: { key: string, value: string }[]
  url?: string
  description?: string | null
  timeout?: number
}

export default function McpConfigDrawer({ open, mode, defaultValues, onClose, onSave }: McpConfigDrawerProps) {
  const _defaultValues = mode === 'edit'
    ? { ...defaultValues, env: defaultValues?.transportType === 'stdio' ? objectToArray(defaultValues?.env || {}) : [], headers: defaultValues?.transportType === 'sse' ? objectToArray(defaultValues?.headers || {}) : [] }
    : {
        icon: '⚒️',
        state: 'disconnected',
        serverName: '',
        url: '',
        command: '',
        args: [],
        env: [],
        headers: [],
        transportType: '',
      }

  const [form] = Form.useForm<McpConfigForm>()
  const [mcpConfig, updateMcpConfig] = useImmer<McpConfigSchema | null>(null)
  const [mcpTools, updateMcpTools] = useImmer<McpTool[]>([])

  const [connectState, setConnectState] = React.useState<'connecting' | 'error' | 'success' | ''>('')
  const [connectError, setConnectError] = React.useState('')

  const transportType = Form.useWatch('transportType', form)

  const serverNameRules = mode === 'add'
    ? [{ required: true }, { validator: validatorServerName }]
    : [{ required: true }]

  function reset() {
    updateMcpConfig(null)
    updateMcpTools([])
    setConnectState('')
    form.resetFields()
  }

  return (
    <Drawer
      open={open}
      title={mode === 'add' ? '添加MCP服务器' : '更新MCP服务器'}
      styles={{ body: { padding: 0 } }}
      placement="bottom"
      size={window.innerHeight - 100}
      destroyOnHidden
      footer={(
        <div className="flex justify-end gap-2">
          <Button onClick={() => {
            reset()
            onClose?.()
          }}
          >
            取消
          </Button>
          <Button
            type="primary"
            onClick={async () => {
              const config: McpConfigForm = await form.validateFields()
              console.log('config => ', JSON.stringify(config))

              let finalConfig: AddMcpConfigSchema | UpdateMcpConfigSchema

              if (mode === 'add') {
                const addConfig = config.transportType === 'stdio'
                  ? {
                      serverName: config.serverName,
                      icon: config.icon,
                      transportType: 'stdio' as const,
                      command: config.command || '',
                      args: config.args || [],
                      env: config.env ? envArrayToObject(config.env) : undefined,
                      description: config.description,
                      timeout: config.timeout,
                    }
                  : {
                      serverName: config.serverName,
                      icon: config.icon,
                      transportType: 'sse' as const,
                      url: config.url || '',
                      headers: config.headers ? envArrayToObject(config.headers) : undefined,
                      description: config.description,
                      timeout: config.timeout,
                    }

                finalConfig = AddMcpConfigSchema.parse(addConfig)
              }
              else {
                const updateConfig = config.transportType === 'stdio'
                  ? {
                      serverName: config.serverName,
                      icon: config.icon,
                      transportType: 'stdio' as const,
                      command: config.command,
                      args: config.args,
                      env: config.env ? envArrayToObject(config.env) : config.env,
                      description: config.description,
                      timeout: config.timeout,
                    }
                  : {
                      serverName: config.serverName,
                      icon: config.icon,
                      transportType: 'sse' as const,
                      url: config.url,
                      headers: config.headers ? envArrayToObject(config.headers) : config.headers,
                      description: config.description,
                      timeout: config.timeout,
                    }

                finalConfig = UpdateMcpConfigSchema.parse(updateConfig)
              }

              onSave?.(finalConfig)
            }}
          >
            {mode === 'edit' ? '更新' : '安装'}
          </Button>
        </div>
      )}
      onClose={() => {
        reset()
        onClose?.()
      }}
    >
      <div className="flex h-full w-full">
        <div className="w-[55vw] flex-shrink-0 overflow-y-auto px-2 pt-5">
          <QuickImport onImport={(e) => {
            if (e.transportType === 'stdio') {
              const result: McpConfigForm = { ...e, env: objectToArray(e.env) }
              form.setFieldsValue(result)
            }
            else {
              const headers = objectToArray(e.headers)

              form.setFieldsValue({ ...e, headers })
            }
          }}
          />

          <div className="px-2 pt-5">
            <Form form={form} layout="vertical" className="flex flex-col gap-5" initialValues={_defaultValues}>
              <Form.Item
                label={<FormItemLabel name="MCP服务类型" tag="transportType" />}
                name="transportType"
                rules={[{ required: true }]}
              >
                <SelectTransportType />
              </Form.Item>

              <Form.Item
                label={<FormItemLabel name="MCP Server 名称" tag="serverName" />}
                name="serverName"
                rules={serverNameRules}
              >
                <Input placeholder="例如: my-mcp-plugin" />
              </Form.Item>

              <Form.Item
                label={<FormItemLabel name="图标" tag="icon" />}
                name="icon"
                rules={[
                  { required: true },
                ]}
              >
                <EmojiPickerHoc />
              </Form.Item>

              {
                transportType === 'sse'
                  ? (
                      <>
                        <Form.Item
                          name="url"
                          label={<FormItemLabel name="请求地址" tag="url" />}
                          validateTrigger="onBlur"
                          rules={[
                            { required: true },
                            { pattern: /^(https?:\/\/)/, message: 'URL必须以http或https开头' },
                          ]}
                        >
                          <Input />
                        </Form.Item>

                        <KeyValueList
                          name="headers"
                          label={<FormItemLabel name="请求头" tag="headers" />}
                        />
                      </>
                    )
                  : transportType === 'stdio'
                    ? (
                        <>
                          <Form.Item
                            name="command"
                            label={<FormItemLabel name="命令" tag="command" />}
                            rules={[{ required: true }]}
                          >
                            <Input placeholder="例如： npx / uv / docker" />
                          </Form.Item>

                          <Form.Item
                            rules={[{ required: true }]}
                            name="args"
                            label={<FormItemLabel name="命令参数" tag="args" />}
                          >
                            <InputArgs />
                          </Form.Item>

                          <KeyValueList
                            name="env"
                            label={<FormItemLabel name="环境变量" tag="env" />}
                            keyPlaceholder="变量名称"
                            valuePlaceholder="变量值"
                            addButtonLabel="添加环境变量"
                          />
                        </>
                      )
                    : null
              }
              {
                connectState === 'error' && connectError
                  ? (
                      <Alert message={connectError} type="error" />
                    )
                  : null
              }

              <div className="flex items-center justify-between">
                <span>测试连接成功后 MCP Server才可以被正常使用</span>
                <Button
                  type="primary"
                  loading={connectState === 'connecting'}
                  onClick={async () => {
                    setConnectError('')
                    updateMcpTools([])
                    let config: McpConfigSchema | McpConfigForm = await form.validateFields().then(data => data)

                    if (config.transportType === 'stdio' && Array.isArray(config.env)) {
                      config = { ...config, env: envArrayToObject(config.env) } as McpConfigSchema
                    }
                    else if (config.transportType === 'sse' && Array.isArray(config.headers)) {
                      config = { ...config, headers: envArrayToObject(config.headers) } as McpConfigSchema
                    }

                    setConnectState('connecting')
                    let result = false
                    try {
                      const [ok, msg] = await connectMcpServer(config as McpConfigSchema)
                      result = ok

                      if (!ok) {
                        throw new Error(msg)
                      }
                    }
                    catch (e) {
                      const message = (e as Error).message
                      setConnectError(message)
                      setConnectState('error')
                      return
                    }
                    updateMcpConfig(config as McpConfigSchema)
                    setConnectState(result ? 'success' : 'error')

                    const tools = await fetchMcpServerTools((config as McpConfigSchema).serverName)
                    updateMcpTools(tools)
                  }}
                >
                  测试连接
                </Button>
              </div>

              <Form.Item
                label={<FormItemLabel name="MCP服务描述" tag="description" />}
                name="description"
                className="pt-4"
              >
                <Input placeholder="补充该MCPfuw的使用说明和场景等信息" />
              </Form.Item>

            </Form>
          </div>
        </div>
        <div className={`
          flex-1 overflow-y-auto bg-[#f8f8f8]
          dark:bg-black
        `}
        >
          {
            mcpTools.length
              ? (
                  <div className="p-3">
                    <div className={`
                      flex items-center gap-3 rounded-md bg-white p-3
                      dark:bg-white/10
                    `}
                    >
                      <div>
                        <Avatar size={36} shape="circle">
                          {mcpConfig?.serverName?.[0]}
                        </Avatar>
                      </div>
                      <div>
                        <div className="text-xl">{mcpConfig?.serverName}</div>
                        <div className="text-xs text-[#a3a3a3]">
                          {mcpConfig?.serverName}
                          {' '}
                          MCP server 共有
                          {mcpTools.length}
                          个工具
                        </div>
                      </div>
                    </div>
                    <PreviewMcpToolsList items={mcpTools} />
                  </div>
                )
              : (
                  <EmptyMcpConfig />
                )
          }
        </div>
      </div>
    </Drawer>
  )
}

function FormItemLabel({ name, tag }: { name: string, tag: string }) {
  return (
    <div className="flex items-center gap-2">
      <span>{name}</span>
      <Tag>{tag}</Tag>
    </div>
  )
}

function EmptyMcpConfig() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <Empty description={null}>
        <div className="text-xl">
          配置MCP后开始预览
        </div>
        <span className="text-gray-500">
          完成配置后，将能够在此处预览MCP Server支持的工具能力
        </span>
      </Empty>
    </div>
  )
}

interface PreviewMcpToolsListProps {
  items: McpTool[]
}

function PreviewMcpToolsList({ items }: PreviewMcpToolsListProps) {
  const [keyword, setKeyword] = React.useState('')
  const showMcpTools = keyword.length ? items.filter(item => item.name.includes(keyword)) : items

  return (
    <div className="mt-4">
      <Input.Search
        value={keyword}
        placeholder="搜索工具"
        onChange={(e) => {
          setKeyword(e.target.value)
        }}
      />
      <div className="mt-2 flex flex-col gap-3">
        {
          showMcpTools.map(tool => (
            <PreviewMcpToolItem key={tool.name} item={tool} />
          ))
        }
      </div>
    </div>
  )
}

function PreviewMcpToolItem({ item }: { item: McpTool }) {
  const [isExpand, setIsExpand] = React.useState(false)

  return (
    <div
      key={item.name}
      className={`
        rounded bg-[#f0f0f0] p-2
        dark:bg-white/10
      `}
    >
      <div className="flex cursor-pointer items-center justify-between gap-2" onClick={() => setIsExpand(!isExpand)}>
        <div className="">
          <div>{item.name}</div>
          <div className="mt-1 text-xs text-[#a3a3a3]">{item.description}</div>
        </div>
        <RightOutlined className="flex-shrink-0" rotate={isExpand ? 90 : 0} />
      </div>
      <div className={`
        grid
        ${isExpand ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}
        transition-all
      `}
      >
        <div className="overflow-hidden">
          <PreviewMcpToolParams item={item} />
        </div>
      </div>
    </div>
  )
}

function PreviewMcpToolParams({ item }: { item: McpTool }) {
  const params = Object.entries(item.inputSchema.properties)
  if (params.length === 0) {
    return (
      <div className="py-2 text-xs text-[#a3a3a3]">
        该工具没有参数
      </div>
    )
  }
  return (
    <div className={`
      mt-2 rounded bg-[#ececec] p-2
      dark:bg-white/10
    `}
    >
      <Descriptions
        size="small"
        column={1}
        title={<span className="text-xs">工具参数</span>}
        items={params.map(t => ({
          key: t[0],
          label: (
            <>
              <span>
                {t[0] as string}
              </span>
              <span className="text-red-500">
                {item.inputSchema.required?.includes(t[0] as string) ? '*' : ''}
              </span>
            </>
          ),
          children: (
            <div className="flex items-center gap-2">
              <Tag>{t[1].type as string}</Tag>
              <span className="text-xs">{t[1]?.description as string}</span>
            </div>
          ),
        }))}
        styles={{ title: { lineHeight: '1' }, header: { marginBottom: '5px' } }}
      />
    </div>
  )
}

function envArrayToObject(envArr: { key: string, value: any }[] = []): Record<string, any> {
  const obj: Record<string, string> = {}
  envArr.forEach((item) => {
    if (item.key)
      obj[item.key] = item.value
  })
  return obj
}

function objectToArray(obj: Record<string, any> = {}) {
  console.log('objectToArray obj => ', obj)
  const result = Object.entries(obj).map(([key, value]) => ({ key, value }))
  console.log('objectToArray result => ', result)
  return result
}

function InputArgs({ value, onChange }: { value?: string[], onChange?: (e: string[]) => void }) {
  return (
    <Select
      mode="tags"
      placeholder="例如： mcp-hello-world"
      value={value}
      suffixIcon={null}
      onChange={(value) => {
        onChange?.(value)
      }}
      styles={{ popup: { root: { display: 'none' } } }}
    />
  )
}

async function validatorServerName(_: RuleObject, value: string) {
  try {
    // 不报错表示已经存在了
    await dbApi.getMcpConfigByServerName(value)
    throw new Error(`${value}已存在, 不可重复添加`)
  }
  catch {
    return true
  }
}
