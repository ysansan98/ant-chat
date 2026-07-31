import type { McpConfigSchema, McpTool } from '@ant-chat/shared'
import type { KeyValueItem } from '@/components/Common/KeyValueList'

import { AddMcpConfigSchema, UpdateMcpConfigSchema } from '@ant-chat/shared'
import { Alert, AlertDescription, AlertTitle } from '@workspace/ui/components/alert'
import { Avatar } from '@workspace/ui/components/avatar'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { Input } from '@workspace/ui/components/input'
import { Label } from '@workspace/ui/components/label'
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@workspace/ui/components/sheet'
import { Switch } from '@workspace/ui/components/switch'
import { ChevronRight, Search } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { getMcpTestResult, testMcpServer } from '@/api/mcpApi'
import { KeyValueList } from '@/components/Common/KeyValueList'
import { EmojiPickerHoc } from '@/components/EmojiPiker'
import { QuickImport } from './QuickImport'
import { SelectTransportType } from './SelectTransportType'

interface McpConfigDrawerProps {
  open: boolean
  mode: 'add' | 'edit'
  defaultValues?: McpConfigSchema
  renamePermissionRuleCount?: number
  onClose?: () => void
  onSave?: (config: AddMcpConfigSchema | UpdateMcpConfigSchema) => Promise<void> | void
}

interface McpConfigForm {
  serverName: string
  icon: string
  transportType: 'stdio' | 'streamable-http' | ''
  command?: string
  args?: string
  env?: KeyValueItem[]
  headers?: KeyValueItem[]
  url?: string
  description?: string | null
  timeout?: number
  /** 是否启用 OAuth 认证 */
  authType?: 'none' | 'oauth'
}

export default function McpConfigDrawer({ open, mode, defaultValues, renamePermissionRuleCount = 0, onClose, onSave }: McpConfigDrawerProps) {
  const _defaultValues: McpConfigForm = mode === 'edit' && defaultValues
    ? {
        serverName: defaultValues.serverName,
        icon: defaultValues.icon,
        transportType: defaultValues.transportType as 'stdio' | 'streamable-http',
        command: (defaultValues as Record<string, unknown>).command as string | undefined,
        args: Array.isArray((defaultValues as Record<string, unknown>).args)
          ? ((defaultValues as Record<string, unknown>).args as string[]).join(',')
          : ((defaultValues as Record<string, unknown>).args as string || ''),
        url: (defaultValues as Record<string, unknown>).url as string | undefined,
        description: defaultValues.description,
        timeout: defaultValues.timeout,
        env: defaultValues.transportType === 'stdio' ? objectToArray((defaultValues as Record<string, unknown>).env as Record<string, unknown> || {}) : [],
        headers: defaultValues.transportType === 'streamable-http' ? objectToArray((defaultValues as Record<string, unknown>).headers as Record<string, unknown> || {}) : [],
        authType: (defaultValues as Record<string, unknown>).authType as 'none' | 'oauth' | undefined ?? 'none',
      }
    : {
        icon: '⚒️',
        serverName: '',
        url: '',
        command: '',
        args: '',
        env: [],
        headers: [],
        transportType: '' as const,
        authType: 'none',
      }

  const { register, handleSubmit, reset, setValue, watch, control, getValues } = useForm<McpConfigForm>({
    defaultValues: _defaultValues,
  })

  const [previewConfig, setPreviewConfig] = useState<McpConfigSchema | null>(null)
  const [previewTools, setPreviewTools] = useState<McpTool[]>([])
  const [connectState, setConnectState] = useState<'connecting' | 'error' | 'success' | 'oauth' | ''>('')
  const [connectError, setConnectError] = useState('')
  const oauthAttemptIdRef = useRef<string | undefined>(undefined)

  const transportType = useWatch({ control, name: 'transportType' })

  function resetAll() {
    setPreviewConfig(null)
    setPreviewTools([])
    setConnectState('')
    setConnectError('')
    oauthAttemptIdRef.current = undefined
    reset()
  }

  // OAuth 回调由桌面本地 callback host 消费；前端只按 attemptId 查询最终结果。
  const oauthPollRef = useRef<ReturnType<typeof setInterval>>(undefined)
  const pollTestServer = useCallback(async () => {
    const attemptId = oauthAttemptIdRef.current
    if (!attemptId)
      return
    try {
      const result = await getMcpTestResult(attemptId)
      if (!result.oauthRequired && !result.error) {
        const form = getValues()
        const config = toAddMcpConfig(form)
        setPreviewConfig(config as McpConfigSchema)
        setPreviewTools(result.tools)
        setConnectState('success')
        oauthAttemptIdRef.current = undefined
      }
      else if (result.error && !result.oauthRequired) {
        setConnectError(result.error)
        setConnectState('error')
        oauthAttemptIdRef.current = undefined
      }
      // oauthRequired still true → keep polling
    }
    catch (error) {
      setConnectError(error instanceof Error ? error.message : String(error))
      setConnectState('error')
    }
  }, [getValues])

  useEffect(() => {
    if (connectState === 'oauth') {
      oauthPollRef.current = setInterval(pollTestServer, 2000)
    }
    else {
      clearInterval(oauthPollRef.current)
    }
    return () => clearInterval(oauthPollRef.current)
  }, [connectState, pollTestServer])

  const onSubmit = async (config: McpConfigForm) => {
    let finalConfig: AddMcpConfigSchema | UpdateMcpConfigSchema

    if (mode === 'add') {
      finalConfig = toAddMcpConfig(config)
    }
    else {
      const updateConfig = config.transportType === 'stdio'
        ? {
            serverName: config.serverName,
            icon: config.icon,
            transportType: 'stdio' as const,
            command: config.command,
            args: config.args ? config.args.split(',').filter(Boolean) : [],
            env: config.env ? envArrayToObject(config.env) : config.env,
            description: config.description,
            timeout: config.timeout,
          }
        : {
            serverName: config.serverName,
            icon: config.icon,
            transportType: 'streamable-http' as const,
            url: config.url,
            headers: config.headers ? envArrayToObject(config.headers) : config.headers,
            description: config.description,
            timeout: config.timeout,
            authType: config.authType === 'oauth' ? 'oauth' : undefined,
          }

      finalConfig = UpdateMcpConfigSchema.parse(updateConfig)
    }

    await onSave?.(finalConfig)
  }

  return (
    <Sheet
      open={open}
      onOpenChange={() => {
        resetAll()
        onClose?.()
      }}
    >
      <SheetContent
        side="bottom"
        className="h-[calc(100vh-40px)]"
      >
        <SheetHeader>
          <SheetTitle>{mode === 'add' ? '添加MCP服务器' : '更新MCP服务器'}</SheetTitle>
        </SheetHeader>
        <div className="flex flex-1 overflow-hidden">
          <div className="w-[55vw] shrink-0 overflow-y-auto px-2 pt-5">
            <QuickImport onImport={(e) => {
              if (e.transportType === 'stdio') {
                setValue('serverName', e.serverName)
                setValue('transportType', 'stdio')
                setValue('command', e.command)
                setValue('args', e.args?.join(','))
                setValue('env', objectToArray(e.env))
                setValue('icon', e.icon)
              }
              else {
                setValue('serverName', e.serverName)
                setValue('transportType', 'streamable-http')
                setValue('url', e.url)
                setValue('headers', objectToArray(e.headers))
                setValue('icon', e.icon)
              }
            }}
            />

            <div className="px-2 pt-5">
              <form
                className="flex flex-col gap-5"
                onSubmit={(e) => {
                  e.preventDefault()
                  handleSubmit(onSubmit)(e)
                }}
              >
                <div className="flex flex-col gap-1">
                  <FormItemLabel name="MCP服务类型" tag="transportType" />
                  <SelectTransportType
                    value={transportType as 'stdio' | 'streamable-http' | undefined}
                    onChange={v => setValue('transportType', v as 'stdio' | 'streamable-http')}
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <FormItemLabel name="MCP Server 名称" tag="serverName" />
                  <Input placeholder="例如: my-mcp-plugin" {...register('serverName', { required: true })} />
                </div>

                {mode === 'edit' && renamePermissionRuleCount > 0 && (
                  <Alert>
                    <AlertTitle>
                      重命名将迁移
                      {' '}
                      {renamePermissionRuleCount}
                      {' '}
                      条权限规则
                    </AlertTitle>
                    <AlertDescription>保存新名称时，服务器配置与相关权限规则会由后端原子更新。</AlertDescription>
                  </Alert>
                )}

                <div className="flex flex-col gap-1">
                  <FormItemLabel name="图标" tag="icon" />
                  <EmojiPickerHoc
                    value={watch('icon')}
                    onChange={e => setValue('icon', e)}
                  />
                </div>

                {transportType === 'streamable-http'
                  ? (
                      <>
                        <div className="flex flex-col gap-1">
                          <FormItemLabel name="请求地址" tag="url" />
                          <Input {...register('url', { required: true, pattern: /^https?:\/\// })} />
                        </div>

                        <KeyValueList
                          label={<FormItemLabel name="请求头" tag="headers" />}
                          value={watch('headers')}
                          onChange={v => setValue('headers', v)}
                        />

                        {/* OAuth 认证 */}
                        <div className="flex items-center justify-between gap-2 rounded-md border p-3">
                          <Label className="text-sm font-medium">OAuth 认证</Label>
                          <Switch
                            checked={watch('authType') === 'oauth'}
                            onCheckedChange={(checked) => {
                              setValue('authType', checked ? 'oauth' : 'none')
                            }}
                          />
                        </div>
                      </>
                    )
                  : transportType === 'stdio'
                    ? (
                        <>
                          <div className="flex flex-col gap-1">
                            <FormItemLabel name="命令" tag="command" />
                            <Input placeholder="例如： npx / uv / docker" {...register('command', { required: true })} />
                          </div>

                          <div className="flex flex-col gap-1">
                            <FormItemLabel name="命令参数" tag="args" />
                            <Input placeholder="参数用逗号分隔" {...register('args')} />
                          </div>

                          <KeyValueList
                            label={<FormItemLabel name="环境变量" tag="env" />}
                            value={watch('env')}
                            onChange={v => setValue('env', v)}
                            keyPlaceholder="变量名称"
                            valuePlaceholder="变量值"
                            addButtonLabel="添加环境变量"
                          />
                        </>
                      )
                    : null}
                {connectState === 'oauth'
                  ? (
                      <Alert>
                        <AlertTitle>请在浏览器中完成 OAuth 授权</AlertTitle>
                        <AlertDescription>授权完成后将自动获取工具列表</AlertDescription>
                      </Alert>
                    )
                  : null}
                {connectState === 'error' && connectError
                  ? (
                      <Alert variant="destructive">
                        <AlertTitle>{connectError}</AlertTitle>
                      </Alert>
                    )
                  : null}

                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm text-muted-foreground">使用隔离连接验证当前配置，不会保存或影响正在运行的服务</span>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={connectState === 'connecting' || connectState === 'oauth'}
                    onClick={async () => {
                      setConnectError('')
                      setPreviewTools([])
                      const form = watch()
                      if (!form.transportType || !form.serverName)
                        return

                      setConnectState('connecting')
                      try {
                        const config = toAddMcpConfig(form)
                        const result = await testMcpServer(config)

                        if (result.oauthRequired && result.attemptId) {
                          oauthAttemptIdRef.current = result.attemptId
                          setConnectState('oauth')
                          return
                        }

                        if (result.error)
                          throw new Error(result.error)
                        setPreviewConfig(config as McpConfigSchema)
                        setPreviewTools(result.tools)
                        setConnectState('success')
                      }
                      catch (error) {
                        setConnectError(error instanceof Error ? error.message : String(error))
                        setConnectState('error')
                      }
                    }}
                  >
                    {connectState === 'connecting' ? '连接中…' : '测试连接'}
                  </Button>
                </div>

                <div className="flex flex-col gap-1 pt-4">
                  <FormItemLabel name="MCP服务描述" tag="description" />
                  <Input placeholder="补充该MCP服务的使用说明和场景等信息" {...register('description')} />
                </div>

                <SheetFooter className="w-full flex-row justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      resetAll()
                      onClose?.()
                    }}
                  >
                    取消
                  </Button>
                  <Button type="submit">
                    {mode === 'edit' ? '更新' : '安装'}
                  </Button>

                </SheetFooter>
              </form>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto bg-muted/50">
            {connectState === 'success'
              ? (
                  <div className="p-3">
                    <div className="flex items-center gap-3 rounded-md bg-card p-3 text-card-foreground">
                      <Avatar className="size-9 rounded-full">
                        <span>{previewConfig?.icon || previewConfig?.serverName?.[0]}</span>
                      </Avatar>
                      <div>
                        <div className="text-xl">{previewConfig?.serverName}</div>
                        <div className="text-xs text-muted-foreground">
                          共发现
                          {' '}
                          {previewTools.length}
                          {' '}
                          个工具
                        </div>
                      </div>
                    </div>
                    <PreviewMcpToolsList items={previewTools} />
                  </div>
                )
              : <EmptyMcpConfig />}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function FormItemLabel({ name, tag }: { name: string, tag: string }) {
  return (
    <div className="flex items-center gap-2">
      <span>{name}</span>
      <Badge variant="outline">{tag}</Badge>
    </div>
  )
}

function EmptyMcpConfig() {
  return (
    <div className="flex size-full items-center justify-center">
      <EmptyState title="测试连接后开始预览">
        <p className="text-muted-foreground">验证配置后，可在此查看 MCP Server 提供的工具。</p>
      </EmptyState>
    </div>
  )
}

function PreviewMcpToolsList({ items }: { items: McpTool[] }) {
  const [keyword, setKeyword] = useState('')
  const visibleTools = keyword ? items.filter(item => item.name.includes(keyword)) : items

  return (
    <div className="mt-4">
      <div className="relative">
        <Input value={keyword} placeholder="搜索工具" onChange={event => setKeyword(event.target.value)} className="pl-8" />
        <Search className="absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
      </div>
      <div className="mt-2 flex flex-col gap-3">
        {visibleTools.map(tool => <PreviewMcpToolItem key={tool.name} item={tool} />)}
      </div>
    </div>
  )
}

function PreviewMcpToolItem({ item }: { item: McpTool }) {
  const [expanded, setExpanded] = useState(false)
  const toggle = () => setExpanded(value => !value)
  return (
    <div className="rounded-sm bg-muted p-2">
      <div
        role="button"
        tabIndex={0}
        className="flex cursor-pointer items-center justify-between gap-2"
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            toggle()
          }
        }}
      >
        <div>
          <div>{item.name}</div>
          <div className="mt-1 text-xs text-muted-foreground">{item.description}</div>
        </div>
        <ChevronRight className={`shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`} />
      </div>
      <div className={`grid transition-[grid-template-rows] ${expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="overflow-hidden">
          <PreviewMcpToolParams item={item} />
        </div>
      </div>
    </div>
  )
}

function PreviewMcpToolParams({ item }: { item: McpTool }) {
  const params = Object.entries(item.inputSchema.properties)
  if (params.length === 0)
    return <div className="py-2 text-xs text-muted-foreground">该工具没有参数</div>

  return (
    <div className="mt-2 rounded-sm bg-background p-2">
      <div className="mb-1 text-xs font-medium">工具参数</div>
      <div className="flex flex-col gap-2">
        {params.map(([key, value]) => (
          <div key={key}>
            <span>
              {key}
              <span className="text-destructive">{item.inputSchema.required?.includes(key) ? '*' : ''}</span>
            </span>
            <div className="flex items-center gap-2">
              <Badge variant="outline">{String(value.type ?? '')}</Badge>
              <span className="text-xs">{String(value.description ?? '')}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function toAddMcpConfig(config: McpConfigForm): AddMcpConfigSchema {
  return AddMcpConfigSchema.parse(config.transportType === 'stdio'
    ? {
        serverName: config.serverName,
        icon: config.icon,
        transportType: 'stdio',
        command: config.command || '',
        args: config.args ? config.args.split(',').filter(Boolean) : [],
        env: envArrayToObject(config.env),
        description: config.description,
        timeout: config.timeout,
      }
    : {
        serverName: config.serverName,
        icon: config.icon,
        transportType: 'streamable-http',
        url: config.url || '',
        headers: envArrayToObject(config.headers),
        description: config.description,
        timeout: config.timeout,
        authType: config.authType === 'oauth' ? 'oauth' : undefined,
      })
}

function envArrayToObject(envArr: KeyValueItem[] = []): Record<string, string> {
  const obj: Record<string, string> = {}
  envArr.forEach((item) => {
    if (item.key)
      obj[item.key] = String(item.value)
  })
  return obj
}

function objectToArray(obj: Record<string, unknown> = {}): KeyValueItem[] {
  return Object.entries(obj).map(([key, value]) => ({ key, value: String(value ?? '') }))
}
