import type { AppControlCommand, AppControlResult } from '@ant-chat/shared'
import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { connect } from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import process from 'node:process'
import { resolveAppDataRoot } from '@ant-chat/shared'

export interface ControlEndpointMeta {
  protocolVersion: number
  pid: number
  endpoint: string
  authToken: string
}

const CONNECT_TIMEOUT_MS = 5_000
// 视觉模型识别是同步调用，慢模型可能超过 60 秒；与 image-recognition SKILL 建议的
// execute_command timeoutMs 对齐，避免 CLI 比调用方更早放弃。
const RESPONSE_TIMEOUT_MS = 120_000

export class SocketClient {
  private meta?: ControlEndpointMeta

  constructor(private readonly appDataRoot: string) {}

  /** 加载 endpoint 元数据 */
  loadMeta(): ControlEndpointMeta {
    if (this.meta)
      return this.meta
    const primary = this.readMeta(this.appDataRoot)
    if (primary && isProcessAlive(primary.pid)) {
      this.meta = primary
      return primary
    }

    // 默认数据根不可用（服务未启动，或端点文件是残留）时，回退探测另一默认根
    // （~/.ant-chat <-> ~/.ant-chat-dev）：CLI 应连接实际运行中的 Runtime，
    // 而不依赖调用方 shell 是否设置了 ANT_CHAT_ENV。显式 --data-dir 的自定义根不做回退。
    const siblingRoot = this.siblingDefaultDataRoot()
    if (siblingRoot) {
      const fallback = this.readMeta(siblingRoot)
      if (fallback && isProcessAlive(fallback.pid)) {
        this.meta = fallback
        return fallback
      }
    }

    const primaryPath = path.join(this.appDataRoot, '.control-endpoint.json')
    if (primary) {
      throw new Error(`无法连接到 ant-chat Runtime。控制进程 ${primary.pid} 已退出，端点元数据为残留（${primaryPath}）`)
    }
    throw new Error(`无法连接到 ant-chat Runtime。请确认服务已启动（${primaryPath}：不存在）`)
  }

  private readMeta(dataRoot: string): ControlEndpointMeta | undefined {
    const metaPath = path.join(dataRoot, '.control-endpoint.json')
    let raw: string
    try {
      raw = readFileSync(metaPath, 'utf-8')
    }
    catch {
      return undefined
    }
    const meta = JSON.parse(raw) as ControlEndpointMeta
    if (meta.protocolVersion !== 1)
      return undefined
    return meta
  }

  /** 当前数据根属于 dev/prod 默认根之一时，返回另一个默认根；自定义根返回 undefined。 */
  private siblingDefaultDataRoot(): string | undefined {
    const current = path.resolve(this.appDataRoot)
    const development = resolveAppDataRoot('development')
    const production = resolveAppDataRoot('production')
    if (current === path.resolve(development))
      return production
    if (current === path.resolve(production))
      return development
    return undefined
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
        reject(new Error('连接超时'))
      }, CONNECT_TIMEOUT_MS)

      socket.on('connect', () => {
        if (connectTimer)
          clearTimeout(connectTimer)

        const request = `${JSON.stringify({ auth: authToken, command })}\n`
        socket.write(request)

        responseTimer = setTimeout(() => {
          cleanup()
          reject(new Error('等待响应超时'))
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
          // 端点元数据里的 pid 已退出时，说明文件是上次运行残留，而不是有进程在监听。
          reject(new Error(`无法连接到 ant-chat Runtime。请确认服务已启动\n  控制端点：${endpoint}${isProcessAlive(meta.pid) ? '' : `（控制进程 ${meta.pid} 已退出，端点元数据为残留）`}`))
        }
        else {
          reject(err)
        }
      })

      socket.on('close', (hadError) => {
        const receivedResponse = buffer.includes(10)
        cleanup()
        if (!hadError && !receivedResponse) {
          reject(new Error('连接在收到完整响应前已关闭'))
        }
      })
    })
  }
}

/** 检查 pid 是否存活（0 信号只探测不发送）。 */
function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0)
    return false
  try {
    process.kill(pid, 0)
    return true
  }
  catch {
    return false
  }
}
