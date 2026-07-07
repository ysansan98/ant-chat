import fs from 'node:fs'
import path from 'node:path'

/**
 * TaskLogWriter — JSONL 日志写入器。
 *
 * 旧格式：logs/tasks/{conversationId}/{userMessageId}.jsonl（按消息拆分）
 * 新格式：logs/tasks/{conversationId}.jsonl（单 Conversation 文件）
 *
 * 约定：
 * - 一个 Conversation 只有一个活跃的 TaskLogWriter 实例。
 * - 自动 Compaction 发生在 Agent Task 启动前，因此 Logger 必须在预压缩之前可用。
 * - 失败路径必须关闭 Logger。
 */
export class TaskLogWriter {
  private stream: fs.WriteStream
  private buffer: string[] = []
  private flushTimer: ReturnType<typeof setInterval>
  readonly filePath: string

  constructor(filePath: string) {
    this.filePath = filePath
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    this.stream = fs.createWriteStream(filePath, { flags: 'a' })
    this.flushTimer = setInterval(() => this.flush(), 1000)
  }

  write(event: string, payload: Record<string, unknown>): void {
    this.buffer.push(JSON.stringify({
      time: Date.now(),
      event,
      payload,
    }))

    if (this.buffer.length >= 10) {
      this.flush()
    }
  }

  private flush(): void {
    if (this.buffer.length === 0)
      return

    const chunk = this.buffer.map(line => `${line}\n`).join('')
    this.buffer.length = 0
    this.stream.write(chunk)
  }

  close(): void {
    clearInterval(this.flushTimer)
    this.flush()
    this.stream.end()
  }
}

/**
 * ConversationTaskLoggerManager — 管理每个 Conversation 的单一日志记录器。
 *
 * 创建 ConversationTaskLogger 时，可以通过 rewritePath 设置新的文件路径格式。
 * 默认路径：{taskLogsRoot}/{conversationId}.jsonl
 */
export class ConversationTaskLoggerManager {
  private loggers = new Map<string, TaskLogWriter>()

  constructor(private readonly taskLogsRoot: string) {}

  getLogger(conversationId: string): TaskLogWriter {
    const existing = this.loggers.get(conversationId)
    if (existing)
      return existing

    const filePath = path.join(this.taskLogsRoot, `${conversationId}.jsonl`)
    const writer = new TaskLogWriter(filePath)
    this.loggers.set(conversationId, writer)
    return writer
  }

  closeLogger(conversationId: string): void {
    const writer = this.loggers.get(conversationId)
    if (writer) {
      writer.close()
      this.loggers.delete(conversationId)
    }
  }

  closeAll(): void {
    for (const writer of this.loggers.values()) {
      writer.close()
    }
    this.loggers.clear()
  }
}

/**
 * 创建旧版 taskLogger factory（向下兼容，但写入新路径格式）。
 * 保留 `userMessageId` 参数签名但忽略它，改用 conversationId 生成路径。
 */
export function createTaskLoggerFactory(taskLogsRoot: string) {
  return (conversationId: string, _userMessageId: string) => {
    const filePath = path.join(taskLogsRoot, `${conversationId}.jsonl`)
    return new TaskLogWriter(filePath)
  }
}

// ================================================================
// Quota Cleanup
// ================================================================

const MAX_TASK_LOGS_SIZE = 512 * 1024 * 1024 // 512 MiB
const TARGET_TASK_LOGS_SIZE = 384 * 1024 * 1024 // 384 MiB

/**
 * 清理 Task JSONL 文件。
 * - 全局上限 512 MiB。
 * - 达到上限后按文件修改时间删除最旧且未在写入中的文件。
 * - 清理到 384 MiB 后停止。
 * - 当前正在写入的 writer 不删除，允许临时超过上限。
 */
export function cleanTaskLogs(
  taskLogsRoot: string,
  activeLoggers: Set<string> = new Set(),
): void {
  const dir = taskLogsRoot
  if (!fs.existsSync(dir))
    return

  const files = fs.readdirSync(dir)
    .filter(file => file.endsWith('.jsonl'))
    .map((file) => {
      const filePath = path.join(dir, file)
      const stat = fs.statSync(filePath)
      return {
        filePath,
        conversationId: file.replace(/\.jsonl$/, ''),
        mtimeMs: stat.mtimeMs,
        size: stat.size,
      }
    })
    .filter(f => !activeLoggers.has(f.conversationId))
    .sort((a, b) => a.mtimeMs - b.mtimeMs) // oldest first

  const totalSize = files.reduce((sum, f) => sum + f.size, 0)

  if (totalSize <= MAX_TASK_LOGS_SIZE)
    return

  let deleted = 0
  for (const file of files) {
    if (totalSize - deleted <= TARGET_TASK_LOGS_SIZE)
      break
    try {
      fs.unlinkSync(file.filePath)
      deleted += file.size
    }
    catch {
      // ignore — file may have been deleted concurrently
    }
  }
}
