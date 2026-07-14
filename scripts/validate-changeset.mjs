#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import process from 'node:process'

const base = process.argv[2] || 'origin/main'
function readChangedFiles(args) {
  return execFileSync('git', args, { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean)
}
const changedFiles = [...new Set([
  ...readChangedFiles(['diff', '--name-only', `${base}...HEAD`]),
  ...readChangedFiles(['diff', '--name-only']),
  ...readChangedFiles(['diff', '--cached', '--name-only']),
])]

const hasChangeset = changedFiles.some(file => file.startsWith('.changeset/') && file.endsWith('.md') && !file.endsWith('README.md'))
const ignored = [
  '.changeset/',
  'docs/',
  'prototypes/',
  'README.md',
  'CHANGELOG.md',
  '.github/',
  'scripts/validate-changeset.mjs',
  'pnpm-lock.yaml',
]
const visibleChange = changedFiles.some(file => !ignored.some(prefix => file === prefix || file.startsWith(prefix)))

const sharedPrefixes = ['packages/backend/', 'packages/shared/', 'packages/control-client/', 'packages/ui/', 'apps/web/']
const hasSharedChange = changedFiles.some(file => sharedPrefixes.some(prefix => file.startsWith(prefix)))
const changesetFiles = changedFiles.filter(file => file.startsWith('.changeset/') && file.endsWith('.md') && !file.endsWith('README.md'))
const changesetText = changesetFiles.map(file => readFileSync(file, 'utf8')).join('\n')
const selectedProducts = new Set()
if (/['"]?ant-chat['"]?\s*:/.test(changesetText))
  selectedProducts.add('ant-chat')
if (/['"]?@ant-chat\/desktop['"]?\s*:/.test(changesetText))
  selectedProducts.add('@ant-chat/desktop')

if (visibleChange && !hasChangeset) {
  console.error('检测到用户可见变更，但没有 changeset。请运行 pnpm changeset 并选择 ant-chat、@ant-chat/desktop 或两者。')
  process.exit(1)
}

if (hasSharedChange && hasChangeset && selectedProducts.size === 1) {
  console.warn(`共享目录发生变更，但 changeset 只选择了 ${[...selectedProducts][0]}。请确认另一个发行物确实不受影响。`)
}

console.info(hasChangeset ? 'changeset coverage: ok' : '没有需要 changeset 的用户可见变更')
