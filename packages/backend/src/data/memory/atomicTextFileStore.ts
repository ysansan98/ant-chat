import { closeSync, existsSync, fsyncSync, mkdirSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'

export class AtomicTextFileStore {
  constructor(readonly filePath: string) {}

  exists(): boolean {
    return existsSync(this.filePath)
  }

  read(): string {
    return readFileSync(this.filePath, 'utf8')
  }

  write(value: string): void {
    const dir = dirname(this.filePath)
    mkdirSync(dir, { recursive: true })

    const tmpDir = mkdtempSync(join(tmpdir(), 'ant-chat-memory-'))
    const tmpPath = join(tmpDir, 'content.tmp')
    try {
      writeFileSync(tmpPath, value === '' || value.endsWith('\n') ? value : `${value}\n`, 'utf8')
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
      if (process.platform !== 'win32') {
        const dirFd = openSync(dir, 'r')
        try {
          fsyncSync(dirFd)
        }
        finally {
          closeSync(dirFd)
        }
      }
    }
    finally {
      rmSync(tmpDir, { force: true, recursive: true })
    }
  }
}
