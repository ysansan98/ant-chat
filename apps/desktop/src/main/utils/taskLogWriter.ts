import fs from 'node:fs'
import path from 'node:path'

/**
 * 按任务的 JSONL 日志写入器。
 *
 * 核心设计：
 * - write() 是同步 API，零 await，调用方零心智负担
 * - 内部使用 fs.createWriteStream，数据先入内存缓冲，libuv 后台异步刷盘
 * - 批量写（满 10 条触发）+ 定时刷（1 秒兜底），兼顾性能和可靠性
 * - 不阻塞 Node.js 事件循环
 */
export class TaskLogWriter {
  private stream: fs.WriteStream
  private buffer: string[] = []
  private flushTimer: ReturnType<typeof setInterval>
  readonly filePath: string

  constructor(filePath: string) {
    this.filePath = filePath
    const dir = path.dirname(filePath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    this.stream = fs.createWriteStream(filePath, { flags: 'a' })

    // 定时刷盘：即使日志量小，也保证最多 1 秒延迟后落盘
    this.flushTimer = setInterval(() => this.flush(), 1000)
  }

  /**
   * 同步写入一条 JSONL 日志事件。
   * 无需 await —— 数据进内存缓冲区，libuv 在后台异步写入磁盘。
   */
  write(event: string, payload: Record<string, unknown>): void {
    const line = JSON.stringify({
      time: Date.now(),
      event,
      payload,
    })
    this.buffer.push(line)

    // 缓冲满阈值，批量刷盘（减少系统调用次数）
    if (this.buffer.length >= 10) {
      this.flush()
    }
  }

  private flush(): void {
    if (this.buffer.length === 0)
      return
    const chunk = this.buffer.map(l => `${l}\n`).join('')
    this.buffer.length = 0
    // stream.write() 内部缓冲，不阻塞事件循环
    this.stream.write(chunk)
  }

  /**
   * 关闭日志流：刷盘 → 关闭定时器 → 关闭文件流
   */
  close(): void {
    clearInterval(this.flushTimer)
    this.flush()
    this.stream.end()
  }
}
