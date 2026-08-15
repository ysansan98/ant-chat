import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

type ArchiveType = 'tar.gz' | 'zip'

interface TargetConfig {
  platformArch: string
  archiveUrl: string
  archiveType: ArchiveType
  binaryName: string
  binaryRelativePathInArchive: string
  sha256: string
}

interface RgLock {
  version: string
  targets: TargetConfig[]
}

const repoRoot = path.resolve(__dirname, '..')
const rgLockPath = path.join(repoRoot, 'scripts', 'rg-lock.json')
const rgOutputRoot = path.join(repoRoot, 'resources', 'rg')
const tmpRoot = path.join(os.tmpdir(), `ant-chat-rg-${Date.now()}`)

async function main() {
  const lock = loadLockFile(rgLockPath)
  // 本地构建只需当前平台的 rg（Windows 上 GNU tar 无法解压 macOS 的 tar.gz 包）；
  // RG_FETCH_ALL=1 保留全量抓取，主机不在清单时回退为全量以维持旧行为。
  const fetchAll = process.env.RG_FETCH_ALL === '1'
  const hostTarget = `${process.platform}-${process.arch}`
  const hostTargets = lock.targets.filter(target => target.platformArch === hostTarget)
  const targets = fetchAll || hostTargets.length === 0 ? lock.targets : hostTargets

  fs.mkdirSync(rgOutputRoot, { recursive: true })
  fs.mkdirSync(tmpRoot, { recursive: true })

  for (const target of targets) {
    await prepareTarget(target)
  }
}

async function prepareTarget(target: TargetConfig) {
  const targetDir = path.join(rgOutputRoot, target.platformArch)
  const targetBinary = path.join(targetDir, target.binaryName)
  const expectedSha = target.sha256.toLowerCase()

  if (fs.existsSync(targetBinary)) {
    const existingSha = sha256File(targetBinary)
    if (existingSha === expectedSha) {
      console.log(`[rg] skip ${target.platformArch}, already up-to-date`)
      return
    }
  }

  const archiveName = path.basename(new URL(target.archiveUrl).pathname)
  const archivePath = path.join(tmpRoot, archiveName)
  const extractRoot = path.join(tmpRoot, `extract-${target.platformArch}`)

  console.log(`[rg] download ${target.platformArch}: ${target.archiveUrl}`)
  await downloadFile(target.archiveUrl, archivePath)
  fs.rmSync(extractRoot, { recursive: true, force: true })
  fs.mkdirSync(extractRoot, { recursive: true })

  extractArchive(target.archiveType, archivePath, extractRoot)

  const extractedBinary = path.join(extractRoot, target.binaryRelativePathInArchive)
  if (!fs.existsSync(extractedBinary)) {
    throw new Error(`[rg] binary not found after extract: ${extractedBinary}`)
  }

  fs.mkdirSync(targetDir, { recursive: true })
  fs.copyFileSync(extractedBinary, targetBinary)
  if (target.binaryName === 'rg') {
    fs.chmodSync(targetBinary, 0o755)
  }

  const actualSha = sha256File(targetBinary)
  if (actualSha !== expectedSha) {
    throw new Error(`[rg] sha256 mismatch for ${target.platformArch}: expected ${expectedSha}, got ${actualSha}`)
  }

  console.log(`[rg] ready ${target.platformArch} -> ${targetBinary}`)
}

function extractArchive(type: ArchiveType, archivePath: string, outputDir: string) {
  if (type === 'tar.gz') {
    execFileSync('tar', ['-xzf', archivePath, '-C', outputDir], { stdio: 'inherit' })
    return
  }

  if (process.platform === 'win32') {
    const script = `Expand-Archive -Path '${archivePath.replace(/'/g, '\'\'')}' -DestinationPath '${outputDir.replace(/'/g, '\'\'')}' -Force`
    execFileSync('powershell', ['-NoProfile', '-Command', script], { stdio: 'inherit' })
    return
  }

  execFileSync('unzip', ['-o', archivePath, '-d', outputDir], { stdio: 'inherit' })
}

function loadLockFile(lockPath: string): RgLock {
  const content = fs.readFileSync(lockPath, 'utf8')
  const parsed = JSON.parse(content) as RgLock
  if (!Array.isArray(parsed.targets) || parsed.targets.length === 0) {
    throw new Error('[rg] invalid rg-lock.json: targets is empty')
  }
  return parsed
}

async function downloadFile(url: string, outputPath: string) {
  const response = await fetch(url)
  if (!response.ok || !response.body) {
    throw new Error(`[rg] download failed: ${url} (${response.status})`)
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  fs.writeFileSync(outputPath, buffer)
}

function sha256File(filePath: string): string {
  const hash = createHash('sha256')
  hash.update(fs.readFileSync(filePath))
  return hash.digest('hex')
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exitCode = 1
})
