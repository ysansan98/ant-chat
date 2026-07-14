import type { AppControlCommand, AppControlResult } from '@ant-chat/shared'
import type { Socket } from 'node:net'
import type { AppControl } from './appControl'
import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import process from 'node:process'

const CONTROL_PROTOCOL_VERSION = 1
const MAX_MESSAGE_BYTES = 1024 * 1024 // 1 MiB
const MESSAGE_TIMEOUT_MS = 30_000
const RUNTIME_LOCK_FILE = '.runtime.lock'

export interface ControlEndpointMeta {
  protocolVersion: number
  pid: number
  endpoint: string
  authToken: string
}

export interface LocalControlServerOptions {
  appDataRoot: string
}

/**
 * LocalControlServer — 本地 Socket 控制传输。
 *
 * - 在 Unix domain socket 或 Windows Named Pipe 上监听
 * - 使用 JSON 行协议：每个请求/响应为一行 JSON
 * - 请求格式：{ auth: string, command: AppControlCommand }
 * - 响应格式：{ ok: boolean, result?: AppControlResult, error?: { code: string, message: string } }
 * - 写入 endpoint 元数据到 appDataRoot，含协议版本、PID、端点、随机 auth token
 */
export class LocalControlServer {
  private server?: ReturnType<typeof createServer>
  private authToken?: string
  private socketPath?: string
  private lockPath?: string

  constructor(
    private readonly appControl: AppControl,
    private readonly options: LocalControlServerOptions,
  ) {}

  /** 启动监听 */
  async start(): Promise<void> {
    const { socketPath, authToken } = this.prepareEndpoint()

    return new Promise<void>((resolve, reject) => {
      this.server = createServer((socket) => {
        this.handleConnection(socket)
      })

      this.server.on('error', (err) => {
        this.cleanupEndpoint()
        reject(err)
      })

      this.server.listen(socketPath, () => {
        this.authToken = authToken
        this.socketPath = socketPath
        this.writeEndpointMeta(socketPath, authToken)
        // 确保 socket 文件权限为 600（仅当前用户可读写）
        try {
          chmodSync(socketPath, 0o600)
        }
        catch {
          // 权限修改失败不阻断
        }
        resolve()
      })
    })
  }

  /** 关闭监听 */
  async stop(): Promise<void> {
    const server = this.server
    this.server = undefined
    if (!server) {
      this.cleanupEndpoint()
      return
    }
    return new Promise<void>((resolve) => {
      server.close(() => {
        this.cleanupEndpoint()
        resolve()
      })
    })
  }

  /** Socket 路径（macOS/Linux）或 pipe 路径（Windows） */
  get endpoint(): string | undefined {
    return this.socketPath
  }

  // ── 私有方法 ──────────────────────────────────────

  private prepareEndpoint(): { socketPath: string, authToken: string } {
    const appDataRoot = this.options.appDataRoot
    if (!existsSync(appDataRoot)) {
      mkdirSync(appDataRoot, { recursive: true })
    }

    this.acquireRuntimeLock(appDataRoot)

    const socketName = `ant-chat-control-${process.pid}.sock`
    const isWindows = os.platform() === 'win32'
    const socketPath = isWindows
      ? `\\\\.\\pipe\\${socketName}`
      : path.join(appDataRoot, socketName)

    // 清除陈旧 socket 文件
    if (!isWindows && existsSync(socketPath)) {
      try {
        unlinkSync(socketPath)
      }
      catch {
        // 陈旧文件无法删除时继续，listen 会失败报错
      }
    }

    const authToken = randomBytes(32).toString('hex')
    return { socketPath, authToken }
  }

  private acquireRuntimeLock(appDataRoot: string): void {
    const metaPath = path.join(appDataRoot, '.control-endpoint.json')
    const lockPath = path.join(appDataRoot, RUNTIME_LOCK_FILE)

    // 先读取旧 endpoint，给用户返回已有实例的端点；原子 lock 负责解决并发启动竞态。
    const existing = readEndpointMeta(metaPath)
    if (existing && typeof existing.pid === 'number' && isProcessAlive(existing.pid))
      throw duplicateRuntimeError(existing.pid, existing.endpoint)

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const fd = openSync(lockPath, 'wx', 0o600)
        try {
          writeFileSync(fd, JSON.stringify({ pid: process.pid }), 'utf8')
        }
        finally {
          closeSync(fd)
        }
        this.lockPath = lockPath
        return
      }
      catch (error) {
        const nodeError = error as NodeJS.ErrnoException
        if (nodeError.code !== 'EEXIST')
          throw error

        const lock = readEndpointMeta(lockPath)
        if (lock && typeof lock.pid === 'number' && isProcessAlive(lock.pid))
          throw duplicateRuntimeError(lock.pid)

        // 崩溃遗留或损坏的锁只清理一次，随后重新走 open('wx') 的原子竞争。
        try {
          unlinkSync(lockPath)
        }
        catch {
          throw duplicateRuntimeError(undefined)
        }
      }
    }

    throw duplicateRuntimeError(undefined)
  }

  private writeEndpointMeta(socketPath: string, authToken: string): void {
    const meta: ControlEndpointMeta = {
      protocolVersion: CONTROL_PROTOCOL_VERSION,
      pid: process.pid,
      endpoint: socketPath,
      authToken,
    }
    // 写入仅当前用户可读的元数据
    writeFileSync(
      path.join(this.options.appDataRoot, '.control-endpoint.json'),
      JSON.stringify(meta, null, 2),
      { mode: 0o600 },
    )
  }

  private cleanupEndpoint(): void {
    try {
      const metaPath = path.join(this.options.appDataRoot, '.control-endpoint.json')
      if (existsSync(metaPath)) {
        unlinkSync(metaPath)
      }
    }
    catch {
      // 清理失败不阻断
    }
    if (this.socketPath && os.platform() !== 'win32' && existsSync(this.socketPath)) {
      try {
        unlinkSync(this.socketPath)
      }
      catch {
        // 忽略
      }
    }
    if (this.lockPath && existsSync(this.lockPath)) {
      try {
        unlinkSync(this.lockPath)
      }
      catch {
        // 忽略
      }
    }
  }

  private handleConnection(socket: Socket): void {
    let buffer = Buffer.alloc(0)
    let timedOut = false

    const timer = setTimeout(() => {
      timedOut = true
      this.sendError(socket, 'TIMEOUT', 'Request timed out')
      socket.destroy()
    }, MESSAGE_TIMEOUT_MS)

    socket.on('data', (chunk: Buffer) => {
      if (timedOut)
        return

      buffer = Buffer.concat([buffer, chunk])

      // 检查请求大小限制
      if (buffer.length > MAX_MESSAGE_BYTES) {
        clearTimeout(timer)
        this.sendError(socket, 'PAYLOAD_TOO_LARGE', `Request exceeds ${MAX_MESSAGE_BYTES} bytes`)
        socket.destroy()
        return
      }

      // 尝试解析完整 JSON 行（以 \n 结尾）
      const newlineIndex = buffer.indexOf(10) // '\n'
      if (newlineIndex === -1) {
        // 还没收到完整的行，继续等待
        return
      }

      clearTimeout(timer)

      const line = buffer.subarray(0, newlineIndex).toString('utf-8')
      // 保留剩余数据（理论上对于单行请求为空）
      buffer = Buffer.alloc(0)

      this.handleRequest(socket, line)
    })

    socket.on('error', () => {
      clearTimeout(timer)
      socket.destroy()
    })

    socket.on('close', () => {
      clearTimeout(timer)
    })
  }

  private async handleRequest(socket: Socket, raw: string): Promise<void> {
    let parsed: { auth: string, command: AppControlCommand }
    try {
      parsed = JSON.parse(raw)

      if (!parsed.auth || typeof parsed.auth !== 'string') {
        this.sendError(socket, 'AUTH_MISSING', 'Missing auth token')
        return
      }

      if (!parsed.command || typeof parsed.command !== 'object') {
        this.sendError(socket, 'INVALID_COMMAND', 'Missing or invalid command')
        return
      }
    }
    catch {
      this.sendError(socket, 'INVALID_JSON', 'Invalid JSON')
      return
    }

    // 认证检查
    if (parsed.auth !== this.authToken) {
      this.sendError(socket, 'AUTH_FAILED', 'Invalid auth token')
      return
    }

    try {
      const result = await this.appControl.execute(parsed.command)
      this.sendResponse(socket, { ok: true, result } as ControlResponse)
    }
    catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.sendError(socket, 'EXECUTION_ERROR', message)
    }
  }

  private sendResponse(socket: Socket, response: ControlResponse): void {
    try {
      socket.end(`${JSON.stringify(response)}\n`)
    }
    catch {
      socket.destroy()
    }
  }

  private sendError(socket: Socket, code: string, message: string): void {
    this.sendResponse(socket, { ok: false, error: { code, message } })
  }
}

function readEndpointMeta(filePath: string): Partial<ControlEndpointMeta> | undefined {
  if (!existsSync(filePath))
    return undefined
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as Partial<ControlEndpointMeta>
  }
  catch {
    return undefined
  }
}

function duplicateRuntimeError(pid: number | undefined, endpoint?: string): NodeJS.ErrnoException {
  const location = endpoint ? `，控制端点 ${endpoint}` : ''
  const error = new Error(pid
    ? `Ant Chat 已在运行（PID ${pid}${location}），同一数据目录不允许启动第二个 Runtime`
    : 'Ant Chat 的 Runtime 锁已被占用，同一数据目录不允许启动第二个 Runtime') as NodeJS.ErrnoException
  error.code = 'EADDRINUSE'
  return error
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  }
  catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

export interface ControlResponse {
  ok: boolean
  result?: AppControlResult
  error?: { code: string, message: string }
}
