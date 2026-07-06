import type { AppControlCommand, AppControlResult } from '@ant-chat/shared'
import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { connect } from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'

export interface ControlEndpointMeta {
  protocolVersion: number
  pid: number
  endpoint: string
  authToken: string
}

const CONNECT_TIMEOUT_MS = 5_000
const RESPONSE_TIMEOUT_MS = 60_000

export class SocketClient {
  private meta?: ControlEndpointMeta

  constructor(private readonly appDataRoot: string) {}

  /** 加载 endpoint 元数据 */
  loadMeta(): ControlEndpointMeta {
    if (this.meta)
      return this.meta
    const metaPath = path.join(this.appDataRoot, '.control-endpoint.json')
    try {
      const raw = readFileSync(metaPath, 'utf-8')
      const meta = JSON.parse(raw) as ControlEndpointMeta
      if (meta.protocolVersion !== 1) {
        throw new Error(`Unsupported protocol version: ${meta.protocolVersion}`)
      }
      this.meta = meta
      return meta
    }
    catch (err) {
      throw new Error(
        `Cannot connect to ant-chat AppRuntime. Is it running? (${metaPath}: ${err instanceof Error ? err.message : String(err)})`,
      )
    }
  }

  /** 发送命令并等待响应 */
  async send(command: AppControlCommand): Promise<{ ok: boolean, result?: AppControlResult, error?: { code: string, message: string } }> {
    const meta = this.loadMeta()
    const { endpoint, authToken } = meta

    return new Promise((resolve, reject) => {
      const socket = os.platform() === 'win32'
        ? connect(endpoint as any)
        : connect(endpoint)

      let connectTimer: ReturnType<typeof setTimeout> | undefined
      let responseTimer: ReturnType<typeof setTimeout> | undefined
      let buffer = Buffer.alloc(0)

      const cleanup = () => {
        if (connectTimer)
          clearTimeout(connectTimer)
        if (responseTimer)
          clearTimeout(responseTimer)
        socket.destroy()
      }

      connectTimer = setTimeout(() => {
        cleanup()
        reject(new Error('Connection timed out'))
      }, CONNECT_TIMEOUT_MS)

      socket.on('connect', () => {
        if (connectTimer)
          clearTimeout(connectTimer)

        const request = `${JSON.stringify({ auth: authToken, command })}\n`
        socket.write(request)

        responseTimer = setTimeout(() => {
          cleanup()
          reject(new Error('Response timed out'))
        }, RESPONSE_TIMEOUT_MS)
      })

      socket.on('data', (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk])
        const newlineIndex = buffer.indexOf(10)
        if (newlineIndex !== -1) {
          if (responseTimer)
            clearTimeout(responseTimer)
          const line = buffer.subarray(0, newlineIndex).toString('utf-8')
          try {
            const parsed = JSON.parse(line)
            cleanup()
            resolve(parsed)
          }
          catch {
            cleanup()
            reject(new Error(`Invalid JSON response: ${line}`))
          }
        }
      })

      socket.on('error', (err) => {
        cleanup()
        // 连接错误可能是 socket 文件不存在或 AppRuntime 未启动
        const nodeErr = err as NodeJS.ErrnoException
        if (nodeErr.code === 'ENOENT' || nodeErr.code === 'ECONNREFUSED') {
          reject(new Error(`Cannot connect to ant-chat AppRuntime. Is it running?\n  Endpoint: ${endpoint}`))
        }
        else {
          reject(err)
        }
      })

      socket.on('close', (hadError) => {
        const receivedResponse = buffer.includes(10)
        cleanup()
        if (!hadError && !receivedResponse) {
          reject(new Error('Connection closed before a complete response was received'))
        }
      })
    })
  }
}
