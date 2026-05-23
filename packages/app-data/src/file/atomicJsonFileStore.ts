import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

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
    const fileFd = openSync(tmpPath, 'r')
    try {
      fsyncSync(fileFd)
    }
    finally {
      closeSync(fileFd)
    }
    renameSync(tmpPath, this.filePath)
    const dirFd = openSync(dir, 'r')
    try {
      fsyncSync(dirFd)
    }
    finally {
      closeSync(dirFd)
    }
  }
}
