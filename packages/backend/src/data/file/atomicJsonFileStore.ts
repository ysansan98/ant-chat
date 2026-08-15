import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import process from 'node:process'

export class AtomicJsonFileStore<T> {
  constructor(private readonly filePath: string) {}

  exists(): boolean {
    return existsSync(this.filePath)
  }

  read(): unknown {
    return JSON.parse(readFileSync(this.filePath, 'utf8'))
  }

  write(value: T): void {
    const dir = dirname(this.filePath)
    mkdirSync(dir, { recursive: true })
    const tmpPath = `${this.filePath}.tmp`
    writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    // Windows 的 fsync 需要写权限句柄（FlushFileBuffers 对只读句柄返回 EPERM）
    const fileFd = openSync(tmpPath, 'r+')
    try {
      fsyncSync(fileFd)
    }
    finally {
      closeSync(fileFd)
    }
    renameSync(tmpPath, this.filePath)
    // Windows 不支持对目录句柄 FlushFileBuffers，目录持久性由 NTFS 元数据日志保证
    if (process.platform === 'win32')
      return
    const dirFd = openSync(dir, 'r')
    try {
      fsyncSync(dirFd)
    }
    finally {
      closeSync(dirFd)
    }
  }
}
