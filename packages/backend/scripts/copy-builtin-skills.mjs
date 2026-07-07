import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(packageRoot, 'builtin-skills')
const target = path.join(packageRoot, 'dist', 'builtin-skills')

await fs.rm(target, { force: true, recursive: true })
await fs.cp(source, target, { recursive: true })
