import fs from 'node:fs'
import path from 'node:path'

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

export function createTaskLoggerFactory(taskLogsRoot: string) {
  return (conversationId: string, userMessageId: string) => {
    const filePath = path.join(taskLogsRoot, conversationId, `${userMessageId}.jsonl`)
    return new TaskLogWriter(filePath)
  }
}
