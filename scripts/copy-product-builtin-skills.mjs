import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
await fs.rm(path.join(root, 'packages/ant-chat/dist/builtin-skills'), { force: true, recursive: true })
await fs.cp(
  path.join(root, 'packages/backend/builtin-skills'),
  path.join(root, 'packages/ant-chat/dist/builtin-skills'),
  { recursive: true },
)
