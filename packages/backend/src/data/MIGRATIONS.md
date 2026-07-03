# app-data 版本迁移操作手册

`app-data` 持久化分为 SQLite 和 JSON 文件，两者都支持从任意旧版本依次升级到最新版本。迁移只允许向前执行；已经发布的版本号和迁移名称不得修改、删除、重排或复用。

## 多版本升级规则

假设用户数据当前为版本 `2`，应用最新版本为 `5`：

```text
2 -> 3 -> 4 -> 5
```

- SQLite：依次执行版本 `3`、`4`、`5`。每个版本单独提交；如果版本 `4` 失败，版本 `3` 保持成功，下次启动从版本 `4` 继续。
- JSON：在内存中依次执行版本 `3`、`4`、`5`，最终校验通过后一次性原子写入版本 `5`。任一步失败都保留原始版本 `2` 文件。
- 缺少中间版本、数据库迁移历史被修改、数据版本高于当前应用版本时，应用会拒绝继续迁移，避免破坏数据。

## SQLite 表结构变更

迁移注册表位于 `sqlite/migrations/appDataMigrations.ts`。`app_data_migrations` 表记录已完成的版本、名称和执行时间。

### 示例：版本 2 增加会话归档字段

只在注册表末尾追加迁移。`schema.ts` 是版本 `1` 的基线快照，发布后不要直接修改，否则新数据库执行完整迁移链时可能重复创建字段。

```ts
export function createAppDataMigrations(
  options: CreateAppDataMigrationsOptions,
): readonly SqliteMigration[] {
  return [
    {
      version: 1,
      name: '初始化 app-data schema',
      migrate(db) {
        initializeAppDataSchema(db)
        migrateAddDurationMs(db)
        migrateMessageAttachments(db, path.resolve(options.attachmentsRootPath))
        rebuildMessagesTable(db)
        migrateAddCompactionBoundary(db)
      },
    },
    {
      version: 2,
      name: '为会话增加归档时间',
      migrate(db) {
        db.exec(`
          ALTER TABLE conversations
          ADD COLUMN archived_at integer DEFAULT NULL;

          CREATE INDEX idx_conversations_archived_at
          ON conversations (archived_at);
        `)
      },
    },
  ]
}
```

同时更新读取该表的 row 类型和 repository。新增字段需要回填旧数据时，在同一个 `migrate` 中先修改结构，再执行 `UPDATE`：

```ts
const migration = {
  version: 3,
  name: '回填会话归档状态',
  migrate(db) {
    db.exec(`
      UPDATE conversations
      SET archived_at = updated_at
      WHERE title = '已归档' AND archived_at IS NULL;
    `)
  },
}
```

删除字段、修改约束等 SQLite 不直接支持的操作，应在一个迁移内创建新表、复制数据、删除旧表并重命名。不要在启动代码中新增临时 `hasColumn` 分支。

### SQLite 测试要求

至少覆盖：

1. 从上一个真实版本表结构升级后，新字段、索引和数据正确。
2. 从空数据库执行完整迁移链后，最终结构正确。
3. 同一迁移链重复运行不会再次修改数据库。
4. 迁移失败时，当前版本的结构修改和历史记录都回滚。

## JSON 文件 schema 变更

应用设置、MCP 设置和工作区设置分别在对应 Store 文件顶部维护 `*_SCHEMA_VERSION` 与 `*_MIGRATIONS`。磁盘格式如下，旧版裸 JSON 自动视为版本 `0`：

```json
{
  "schemaVersion": 1,
  "data": {}
}
```

### 示例：应用设置版本 2 增加侧边栏状态

第一步，更新 `packages/shared/src/schemas/appSettings.ts` 中的最终 schema，并在 `defaultAppSettings.ts` 中提供新安装用户的默认值。

第二步，在 `appSettingsStore.ts` 增加旧数据到新数据的迁移：

```ts
function migrateAppSettingsToVersion2(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('版本 1 应用设置不是对象')
  }

  return {
    ...value,
    sidebarCollapsed: false,
  }
}

const APP_SETTINGS_SCHEMA_VERSION = 2
const APP_SETTINGS_MIGRATIONS = [
  { version: 1, migrate: (value: unknown) => value },
  { version: 2, migrate: migrateAppSettingsToVersion2 },
] as const
```

如果随后版本 `3` 把字段改名，继续在末尾追加迁移，不要修改版本 `2`：

```ts
function migrateAppSettingsToVersion3(value: unknown): unknown {
  const settings = value as Record<string, unknown>
  const { sidebarCollapsed, ...rest } = settings
  return {
    ...rest,
    navigationCollapsed: sidebarCollapsed,
  }
}

const APP_SETTINGS_SCHEMA_VERSION = 3
const APP_SETTINGS_MIGRATIONS = [
  { version: 1, migrate: (value: unknown) => value },
  { version: 2, migrate: migrateAppSettingsToVersion2 },
  { version: 3, migrate: migrateAppSettingsToVersion3 },
] as const
```

迁移函数只负责把上一个版本转换为下一个版本。不要在迁移中读写文件；`VersionedJsonFileStore` 会在全部迁移成功并通过最终 schema 校验后统一写入。

### JSON 测试要求

至少覆盖：

1. 上一个版本升级后的业务数据和 `schemaVersion` 正确。
2. 跨多个版本时，每个迁移按顺序生效。
3. 迁移或最终 schema 校验失败时，原文件内容不变。
4. 高于当前应用版本的文件不会被 `resetInvalidFile` 覆盖。

## 发布前检查

```bash
pnpm -F @ant-chat/backend test
pnpm check
```

测试通过后，使用一个真实旧版本数据库和配置文件启动应用，确认迁移完成、原有数据可读且核心增删改流程正常。
