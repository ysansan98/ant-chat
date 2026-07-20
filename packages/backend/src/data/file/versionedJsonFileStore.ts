import { AtomicJsonFileStore } from './atomicJsonFileStore'

export interface JsonFileMigration {
  version: number
  migrate: (value: unknown) => unknown
}

export interface VersionedJsonFileStoreOptions<T> {
  currentVersion: number
  migrations: readonly JsonFileMigration[]
  parse: (value: unknown) => T
}

interface VersionedJsonFile<T> {
  schemaVersion: number
  data: T
}

export class UnsupportedJsonSchemaVersionError extends Error {}

export class JsonFileMigrationError extends Error {
  constructor(version: number, readonly migrationCause: unknown) {
    super(`文件 schema 迁移到版本 ${version} 失败`)
  }
}

/**
 * 将 schema 版本与业务数据原子写入同一个文件，避免升级成功后版本号未落盘。
 * 旧版裸 JSON 自动视为 0 版本，因此现有用户文件可以进入同一条迁移链。
 */
export class VersionedJsonFileStore<T> {
  private readonly store: AtomicJsonFileStore<VersionedJsonFile<T>>

  constructor(
    filePath: string,
    private readonly options: VersionedJsonFileStoreOptions<T>,
  ) {
    this.store = new AtomicJsonFileStore(filePath)
    validateMigrationChain(options.currentVersion, options.migrations)
  }

  exists(): boolean {
    return this.store.exists()
  }

  read(): T {
    const raw = this.store.read()
    const file = parseVersionedFile(raw)

    if (file.schemaVersion > this.options.currentVersion) {
      throw new UnsupportedJsonSchemaVersionError(
        `文件 schema 版本 ${file.schemaVersion} 高于当前支持的 ${this.options.currentVersion}`,
      )
    }

    let data = file.data
    for (const migration of this.options.migrations) {
      if (migration.version > file.schemaVersion) {
        try {
          data = migration.migrate(data)
        }
        catch (error) {
          throw new JsonFileMigrationError(migration.version, error)
        }
      }
    }

    const parsed = this.options.parse(data)
    if (file.schemaVersion !== this.options.currentVersion) {
      this.store.write({
        schemaVersion: this.options.currentVersion,
        data: parsed,
      })
    }
    return parsed
  }

  write(value: T): void {
    const parsed = this.options.parse(value)
    this.store.write({
      schemaVersion: this.options.currentVersion,
      data: parsed,
    })
  }
}

function parseVersionedFile(value: unknown): { schemaVersion: number, data: unknown } {
  if (
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && Number.isInteger((value as Record<string, unknown>).schemaVersion)
    // eslint-disable-next-line e18e/prefer-object-has-own -- 当前 TypeScript lib 不包含 Object.hasOwn。
    && Object.prototype.hasOwnProperty.call(value, 'data')
  ) {
    const file = value as Record<string, unknown>
    return {
      schemaVersion: file.schemaVersion as number,
      data: file.data,
    }
  }

  return { schemaVersion: 0, data: value }
}

function validateMigrationChain(
  currentVersion: number,
  migrations: readonly JsonFileMigration[],
): void {
  if (!Number.isInteger(currentVersion) || currentVersion < 0) {
    throw new Error(`无效的当前 schema 版本: ${currentVersion}`)
  }

  const versions = migrations.map(migration => migration.version)
  const expectedVersions = Array.from({ length: currentVersion }, (_, index) => index + 1)
  if (
    versions.length !== expectedVersions.length
    || versions.some((version, index) => version !== expectedVersions[index])
  ) {
    throw new Error(`文件迁移必须从版本 1 连续注册到版本 ${currentVersion}`)
  }
}
