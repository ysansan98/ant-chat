import type { AddMcpConfigSchema } from '@ant-chat/shared'
import { Alert, AlertTitle } from '@workspace/ui/components/alert'
import { Button } from '@workspace/ui/components/button'
import { Textarea } from '@workspace/ui/components/textarea'
import React from 'react'
import { parseMcpServerJsonText } from './quickImportParser'

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
              <Alert variant="destructive" className="mb-2">
                <AlertTitle>{error}</AlertTitle>
              </Alert>
            )
          }
          <Textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value)
            }}
            rows={10}
            placeholder={placeholder.trim()}
            onFocus={() => {
              setError('')
            }}
          />
          <div className="mt-1 flex items-center justify-end gap-1">
            <Button size="sm" variant="outline" onClick={() => setQuickImport(false)}>取消</Button>
            <Button
              size="sm"
              onClick={() => {
                if (!text.length) {
                  setError('输入内容不能为空')
                  return
                }
                try {
                  const mcpConfig = parseMcpServerJsonText(text)
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
          variant="outline"
          className="w-full"
          onClick={() => {
            setQuickImport(true)
          }}
        >
          快速导入JSON配置
        </Button>
      )
}
