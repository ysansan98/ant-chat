import { AddMcpConfigSchema } from '@ant-chat/shared'
import { Alert, Button } from 'antd'
import TextArea from 'antd/es/input/TextArea'
import React from 'react'

interface QuickImportProps {
  onImport?: (e: AddMcpConfigSchema) => void
}

export function QuickImport({ onImport }: QuickImportProps) {
  const [quickImport, setQuickImport] = React.useState(false)
  const [text, setText] = React.useState('')
  const [error, setError] = React.useState('')

  const placeholder = `
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/home/ant-chat"
      ]
    }
  }
}
`

  return quickImport
    ? (
        <div>
          {
            error.length > 0 && (
              <Alert type="error" message={error} showIcon className="mb-2" />
            )
          }
          <TextArea
            value={text}
            onChange={(e) => {
              setText(e.target.value)
            }}
            autoSize={{ minRows: 10, maxRows: 10 }}
            placeholder={placeholder.trim()}
            onFocus={() => {
              setError('')
            }}
          />
          <div className="mt-1 flex items-center justify-end gap-1">
            <Button size="small" onClick={() => setQuickImport(false)}>取消</Button>
            <Button
              size="small"
              type="primary"
              onClick={() => {
                if (!text.length) {
                  setError('输入内容不能为空')
                  return
                }
                try {
                  const mcpConfig = parseMcpServerJsonText(text)
                  console.log('parseMcpServerJsonText => ', mcpConfig)
                  onImport?.(mcpConfig)
                  setText('')
                  setQuickImport(false)
                }
                catch (e) {
                  setError((e as Error).message)
                }
              }}
            >
              导入
            </Button>
          </div>
        </div>
      )
    : (
        <Button
          block
          color="default"
          variant="dashed"
          style={{ paddingTop: '5px', paddingBottom: '5px' }}
          onClick={() => {
            setQuickImport(true)
          }}
        >
          快速导入JSON配置
        </Button>
      )
}

interface ServerJson {
  mcpServers: {
    [key: string]: {
      transportType?: 'sse' | 'stdio'
      command?: string
      args?: string[]
      env?: Record<string, string | number | boolean>
      url?: string
    }
  }
}

function parseMcpServerJsonText(text: string): AddMcpConfigSchema {
  const data = JSON.parse(text) as ServerJson
  if (typeof data.mcpServers !== 'object') {
    throw new TypeError('mcpServers 格式错误')
  }
  const entries = Object.entries(data.mcpServers)

  if (entries.length === 0) {
    throw new Error('mcpServers 为空')
  }

  const [serverName, config] = entries[0]

  const options = { ...config, icon: '🛠️', serverName, transportType: 'stdio' }

  if (config.url) {
    options.transportType = 'sse'
  }
  console.log(' options => ', options)
  return AddMcpConfigSchema.parse(options)
}
