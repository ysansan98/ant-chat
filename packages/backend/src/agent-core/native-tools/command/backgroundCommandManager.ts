import type {
  BackgroundCommandNotice,
  BackgroundCommandNoticeReason,
  BackgroundCommandReadResult,
  BackgroundCommandStatus,
  BackgroundCommandSummary,
  ILogger,
} from '@ant-chat/shared'
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from 'node:child_process'
import type { AgentCommandPaths } from '../../../agentCommands'
import type { PreparedCommandState } from './types'
import { Buffer } from 'node:buffer'
import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { scheduleHardKill, terminateProcessTree } from './processTree'
import { createStreamRedactor } from './redactSecrets'

const execFileAsync = promisify(execFile)

/** 每会话并发上限；超出直接拒绝，不排队。 */
const MAX_ACTIVE_COMMANDS = 8
/** 每会话最多保留的未消费结束通知，超出丢弃最旧的。 */
const MAX_PENDING_NOTICES = 50
/** 单个日志文件大小上限，防止长驻进程占满磁盘。 */
const MAX_LOG_BYTES = 20 * 1024 * 1024
const TRUNCATED_MARKER = '\n[output truncated: limit reached]\n'
const DEFAULT_MAX_READ_BYTES = 65_536
const MAX_MAX_READ_BYTES = 262_144
const MAX_WAIT_MS = 30_000

export type SpawnProcess = (
  executablePath: string,
  args: readonly string[],
  options: SpawnOptionsWithoutStdio,
) => ChildProcessWithoutNullStreams

export interface BackgroundCommandManagerOptions {
  onChanged?: (conversationId: string, commands: BackgroundCommandSummary[]) => void
  logger?: ILogger
  /** 测试注入的 spawn。 */
  spawnProcess?: SpawnProcess
  /** 测试注入的进程校验探针；返回 null 表示无法确认（不 kill，只清状态文件）。 */
  probeProcess?: (pid: number) => Promise<{ commandLine?: string } | null>
  killGraceMs?: number
  /** 单条日志大小上限；测试可调小。 */
  maxLogBytes?: number
}

export interface StartBackgroundCommandOptions {
  /** 已解析的 Turn 密钥值（仅注入子进程环境，不落库）。 */
  secretEnv?: Record<string, string>
  /** 看门狗：运行满该时长后自动终止；缺省不限时长。 */
  watchdogMs?: number
  spawnProcess?: SpawnProcess
}

export interface ReadBackgroundCommandOptions {
  offset?: number
  maxChars?: number
  waitMs?: number
  /** 读取最后 N 字节（UI 尾部预览）；与 offset 互斥，优先。 */
  tail?: number
  /**
   * 读取到终态时同时消费该命令的结束通知。
   * 只应由 agent 的 read_command_output 传 true —— UI 的日志预览不能替 agent 消费通知。
   */
  consumeNotices?: boolean
}

export type StartBackgroundCommandResult
  = | { ok: true, summary: BackgroundCommandSummary }
    | { ok: false, reason: string }

interface CommandRecord {
  conversationId: string
  command: string
  commandFingerprint: string
  resourceScope: 'workspace' | 'outside'
  summary: BackgroundCommandSummary
  child?: ChildProcessWithoutNullStreams
  writeStream?: fs.WriteStream
  bytesWritten: number
  maxLogBytes: number
  /** 结束原因；未设置表示自然退出。 */
  killReason?: BackgroundCommandNoticeReason
  waiters: Set<() => void>
  exitPromise: Promise<void>
  resolveExit: () => void
  watchdog?: ReturnType<typeof setTimeout>
}

/**
 * 会话级后台命令管理器。
 *
 * 与 BrowserSessionManager 同构：由 SessionRuntime per-conversation 持有，
 * 跨 turn 存活，直到显式终止、会话关闭或 Runtime dispose。命令记录为内存态，
 * 日志与孤儿兜底状态文件落在应用数据目录。
 */
export class BackgroundCommandManager {
  private readonly records = new Map<string, CommandRecord>()
  private readonly notices = new Map<string, BackgroundCommandNotice[]>()
  private readonly options: BackgroundCommandManagerOptions
  private sequence = 0
  private disposed = false

  constructor(
    private readonly paths: AgentCommandPaths,
    options: BackgroundCommandManagerOptions = {},
  ) {
    this.options = options
  }

  /** App 启动时扫描残留状态文件，校验后回收孤儿进程。 */
  async initialize(): Promise<void> {
    await fs.promises.mkdir(this.paths.statePath, { recursive: true }).catch(() => {})
    let files: string[] = []
    try {
      files = await fs.promises.readdir(this.paths.statePath)
    }
    catch {
      return
    }
    for (const file of files) {
      if (!file.endsWith('.json'))
        continue
      const statePath = path.join(this.paths.statePath, file)
      try {
        const raw = await fs.promises.readFile(statePath, 'utf8')
        const record = JSON.parse(raw) as OrphanStateFile
        await this.reconcileOrphan(record)
      }
      catch (error) {
        this.options.logger?.warn('后台命令孤儿状态文件解析失败，已忽略', error)
      }
      await fs.promises.rm(statePath, { force: true }).catch(() => {})
    }
  }

  start(
    conversationId: string,
    prepared: PreparedCommandState,
    options: StartBackgroundCommandOptions = {},
  ): StartBackgroundCommandResult {
    if (this.disposed)
      return { ok: false, reason: '后台命令管理器已释放' }
    if (prepared.risk === 'bottomline_block')
      return { ok: false, reason: prepared.riskReason || '命令命中不可覆盖的底线保护' }
    if (this.countActive(conversationId) >= MAX_ACTIVE_COMMANDS)
      return { ok: false, reason: `该会话后台命令已达上限（${MAX_ACTIVE_COMMANDS} 个），请先终止部分命令` }

    const commandId = `cmd-${Date.now().toString(36)}-${(++this.sequence).toString(36)}`
    const logPath = path.join(this.paths.logsPath, `${commandId}.log`)
    const summary = {
      commandId,
      command: prepared.command,
      description: prepared.input.description,
      cwd: prepared.executionPlan.cwd,
      status: 'running' as BackgroundCommandStatus,
      pid: undefined as number | undefined,
      exitCode: undefined as number | undefined,
      startedAt: Date.now(),
      endedAt: undefined as number | undefined,
      hasSecretEnv: Object.keys(options.secretEnv ?? {}).length > 0,
      secretEnvKeys: Object.keys(options.secretEnv ?? {}).sort(),
      logPath,
      truncated: false,
    }

    let resolveExit: () => void = () => {}
    const exitPromise = new Promise<void>((resolve) => {
      resolveExit = resolve
    })
    const record: CommandRecord = {
      conversationId,
      command: prepared.command,
      commandFingerprint: fingerprintCommand(prepared.command, prepared.executionPlan.cwd),
      resourceScope: prepared.resourceScope,
      summary,
      bytesWritten: 0,
      maxLogBytes: this.options.maxLogBytes ?? MAX_LOG_BYTES,
      waiters: new Set(),
      exitPromise,
      resolveExit,
    }

    const spawnProcess = options.spawnProcess ?? this.options.spawnProcess ?? defaultSpawn
    let child: ChildProcessWithoutNullStreams
    try {
      fs.mkdirSync(this.paths.logsPath, { recursive: true })
      fs.mkdirSync(this.paths.statePath, { recursive: true })
      const stream = fs.createWriteStream(logPath, { flags: 'a' })
      record.writeStream = stream
      stream.on('error', (error) => {
        this.options.logger?.warn(`后台命令日志写入失败：${commandId}`, error)
      })
      child = spawnProcess(
        prepared.executionPlan.executablePath,
        prepared.executionPlan.args,
        {
          cwd: prepared.executionPlan.cwd,
          detached: process.platform !== 'win32',
          shell: false,
          windowsHide: true,
          env: {
            ...prepared.executionPlan.environment,
            ...sanitizeSecretEnvironment(options.secretEnv),
          },
        },
      )
    }
    catch (error) {
      record.writeStream?.end()
      this.options.logger?.warn(`后台命令启动失败：${commandId}`, error)
      return { ok: false, reason: error instanceof Error ? error.message : '后台命令启动失败' }
    }

    record.child = child
    summary.pid = child.pid
    this.records.set(commandId, record)

    writeLogChunk(record, renderLogHeader(record, options.secretEnv))
    this.attachProcess(record, child, options.secretEnv ?? {})
    this.writeStateFile(record)

    if (options.watchdogMs && options.watchdogMs > 0) {
      record.watchdog = setTimeout(() => {
        record.killReason = 'watchdog'
        terminateProcessTree(child.pid, 'SIGTERM')
        scheduleHardKill(child.pid)
      }, options.watchdogMs)
      record.watchdog.unref?.()
    }

    this.notifyChanged(conversationId)
    return { ok: true, summary: { ...summary } }
  }

  async read(
    conversationId: string,
    commandId: string,
    options: ReadBackgroundCommandOptions = {},
  ): Promise<BackgroundCommandReadResult> {
    const record = this.requireRecord(conversationId, commandId)
    // agent 已经读到终态时，同一条结束通知不再重复注入
    const settle = (result: BackgroundCommandReadResult): BackgroundCommandReadResult => {
      if (options.consumeNotices && result.status !== 'running')
        this.discardNotices(conversationId, record.summary.commandId)
      return result
    }
    const waitMs = clamp(options.waitMs ?? 0, 0, MAX_WAIT_MS)
    if (waitMs > 0 && record.summary.status === 'running') {
      await this.waitForChange(record, waitMs)
    }
    const maxChars = clamp(options.maxChars ?? DEFAULT_MAX_READ_BYTES, 1, MAX_MAX_READ_BYTES)
    const size = await this.logSize(record)
    let offset = clamp(options.offset ?? 0, 0, size)
    if (options.tail !== undefined && options.tail > 0) {
      offset = Math.max(0, size - options.tail)
    }
    if (offset >= size) {
      await this.syncTruncatedFlag(record, size)
      return settle({
        text: '',
        status: record.summary.status,
        exitCode: record.summary.exitCode,
        offset,
        nextOffset: size,
        truncated: record.summary.truncated,
      })
    }
    const length = Math.min(maxChars, size - offset)
    const buffer = Buffer.alloc(length)
    const handle = await fs.promises.open(record.summary.logPath, 'r')
    try {
      const { bytesRead } = await handle.read(buffer, 0, length, offset)
      const text = buffer.subarray(0, bytesRead).toString('utf8')
      const nextOffset = offset + bytesRead
      await this.syncTruncatedFlag(record, await this.logSize(record))
      return settle({
        text,
        status: record.summary.status,
        exitCode: record.summary.exitCode,
        offset,
        nextOffset,
        truncated: record.summary.truncated,
      })
    }
    finally {
      await handle.close().catch(() => {})
    }
  }

  async kill(
    conversationId: string,
    commandId: string,
    signal: NodeJS.Signals = 'SIGTERM',
    actor: 'user' | 'agent' = 'user',
  ): Promise<BackgroundCommandSummary | null> {
    const record = this.records.get(commandId)
    if (!record || record.conversationId !== conversationId)
      return null
    if (record.summary.status !== 'running')
      return this.toSummary(record)
    record.killReason = actor === 'agent' ? 'agent_killed' : 'user_killed'
    terminateProcessTree(record.summary.pid, signal)
    if (signal !== 'SIGKILL')
      scheduleHardKill(record.summary.pid)
    await Promise.race([record.exitPromise, delay(this.killGraceMs() + 500)])
    return this.toSummary(record)
  }

  /**
   * 该 commandId 对应的资源域，供工具授权推导 scope。
   * 未找到（或不属于该会话）返回 null，由调用方决定如何处理。
   */
  scopeOf(conversationId: string, commandId: string): 'workspace' | 'outside' | null {
    const record = this.records.get(commandId)
    if (!record || record.conversationId !== conversationId)
      return null
    return record.resourceScope
  }

  list(conversationId: string): BackgroundCommandSummary[] {
    return [...this.records.values()]
      .filter(record => record.conversationId === conversationId)
      .sort((left, right) => right.summary.startedAt - left.summary.startedAt)
      .map(record => this.toSummary(record))
  }

  async closeConversation(conversationId: string): Promise<void> {
    const records = [...this.records.values()].filter(record => record.conversationId === conversationId)
    await Promise.all(records.map(record => this.terminateRecord(record, 'session_closed')))
    for (const record of records)
      this.records.delete(record.summary.commandId)
    this.notices.delete(conversationId)
  }

  async dispose(): Promise<void> {
    this.disposed = true
    const records = [...this.records.values()]
    await Promise.all(records.map(record => this.terminateRecord(record, 'disposed')))
    this.records.clear()
    this.notices.clear()
  }

  /** 消费即清：返回该会话待处理的后台命令结束通知。 */
  takeNotices(conversationId: string): BackgroundCommandNotice[] {
    const pending = this.notices.get(conversationId)
    if (!pending || pending.length === 0)
      return []
    this.notices.delete(conversationId)
    return pending
  }

  peekNotices(conversationId: string): BackgroundCommandNotice[] {
    return [...(this.notices.get(conversationId) ?? [])]
  }

  /** 丢弃单条命令的待处理通知（agent 已通过 read_command_output 读到终态）。 */
  private discardNotices(conversationId: string, commandId: string): void {
    const pending = this.notices.get(conversationId)
    if (!pending)
      return
    const remaining = pending.filter(notice => notice.commandId !== commandId)
    if (remaining.length === 0)
      this.notices.delete(conversationId)
    else
      this.notices.set(conversationId, remaining)
  }

  private async terminateRecord(record: CommandRecord, reason: 'session_closed' | 'disposed'): Promise<void> {
    if (record.summary.status !== 'running') {
      record.writeStream?.end()
      return
    }
    record.killReason = reason
    terminateProcessTree(record.summary.pid, 'SIGTERM')
    scheduleHardKill(record.summary.pid)
    await Promise.race([record.exitPromise, delay(this.killGraceMs() + 500)])
    await this.removeStateFile(record.summary.commandId)
  }

  private attachProcess(
    record: CommandRecord,
    child: ChildProcessWithoutNullStreams,
    secretEnv: Record<string, string>,
  ): void {
    const stdout = createStreamRedactor(Object.values(secretEnv))
    const stderr = createStreamRedactor(Object.values(secretEnv))
    child.stdout?.on('data', (chunk: Buffer) => {
      writeLogChunk(record, stdout.write(chunk.toString()))
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      writeLogChunk(record, stderr.write(chunk.toString()))
    })
    child.on('error', (error) => {
      this.options.logger?.warn(`后台命令进程错误：${record.summary.commandId}`, error)
      this.finalize(record, null)
    })
    child.on('exit', (code) => {
      const tail = stdout.flush() + stderr.flush()
      if (tail)
        writeLogChunk(record, tail)
      this.finalize(record, code)
    })
  }

  private finalize(record: CommandRecord, code: number | null): void {
    if (record.summary.status !== 'running')
      return
    record.summary.status = record.killReason ? 'killed' : 'exited'
    record.summary.exitCode = code ?? undefined
    record.summary.endedAt = Date.now()
    if (record.watchdog)
      clearTimeout(record.watchdog)
    record.writeStream?.end()
    this.notifyWaiters(record)
    this.resolveExitSafe(record)
    void this.removeStateFile(record.summary.commandId)
    this.enqueueNotice(record)
    this.notifyChanged(record.conversationId)
  }

  /**
   * 结束事件入队，供 agent 感知。
   *
   * agent 自己发起的 kill 不回队（避免回声）；会话关闭与应用退出注入也不回队
   * （会话已经或即将消失，通知没有接收方）。
   */
  private enqueueNotice(record: CommandRecord): void {
    const reason = record.killReason ?? 'exited'
    if (reason === 'agent_killed' || reason === 'session_closed' || reason === 'disposed')
      return
    const notice: BackgroundCommandNotice = {
      commandId: record.summary.commandId,
      command: record.summary.command,
      description: record.summary.description,
      status: record.summary.status === 'running' ? 'exited' : record.summary.status,
      exitCode: record.summary.exitCode,
      reason,
      startedAt: record.summary.startedAt,
      endedAt: record.summary.endedAt ?? Date.now(),
    }
    const pending = this.notices.get(record.conversationId) ?? []
    pending.push(notice)
    // 只保留最新的一批，避免高频结束的命令无限占用上下文
    this.notices.set(
      record.conversationId,
      pending.length > MAX_PENDING_NOTICES ? pending.slice(pending.length - MAX_PENDING_NOTICES) : pending,
    )
  }

  private resolveExitSafe(record: CommandRecord): void {
    try {
      record.resolveExit()
    }
    catch {
      // promise 已 settle，忽略
    }
  }

  private async waitForChange(record: CommandRecord, waitMs: number): Promise<void> {
    await new Promise<void>((resolve) => {
      let done = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const finish = () => {
        if (done)
          return
        done = true
        record.waiters.delete(finish)
        if (timer)
          clearTimeout(timer)
        resolve()
      }
      timer = setTimeout(finish, waitMs)
      timer.unref?.()
      record.waiters.add(finish)
    })
  }

  private notifyWaiters(record: CommandRecord): void {
    for (const waiter of [...record.waiters])
      waiter()
  }

  private requireRecord(conversationId: string, commandId: string): CommandRecord {
    const record = this.records.get(commandId)
    if (!record || record.conversationId !== conversationId)
      throw new Error('后台命令不存在或不属于当前会话')
    return record
  }

  private countActive(conversationId: string): number {
    return [...this.records.values()]
      .filter(record => record.conversationId === conversationId && record.summary.status === 'running')
      .length
  }

  private logSize(record: CommandRecord): Promise<number> {
    return fs.promises.stat(record.summary.logPath)
      .then(stat => stat.size)
      .catch(() => 0)
  }

  private async syncTruncatedFlag(record: CommandRecord, size: number): Promise<void> {
    if (record.summary.truncated || size < record.maxLogBytes)
      return
    record.summary.truncated = true
    this.notifyChanged(record.conversationId)
  }

  private toSummary(record: CommandRecord): BackgroundCommandSummary {
    return { ...record.summary, secretEnvKeys: [...record.summary.secretEnvKeys] }
  }

  private notifyChanged(conversationId: string): void {
    try {
      this.options.onChanged?.(conversationId, this.list(conversationId))
    }
    catch (error) {
      this.options.logger?.warn('后台命令变更通知失败', error)
    }
  }

  private writeStateFile(record: CommandRecord): void {
    if (record.summary.pid === undefined)
      return
    const state: OrphanStateFile = {
      commandId: record.summary.commandId,
      pgid: record.summary.pid,
      pid: record.summary.pid,
      startedAt: record.summary.startedAt,
      commandFingerprint: record.commandFingerprint,
      command: record.command,
      cwd: record.summary.cwd,
    }
    const target = path.join(this.paths.statePath, `${record.summary.commandId}.json`)
    void fs.promises.writeFile(target, JSON.stringify(state)).catch((error) => {
      this.options.logger?.warn(`后台命令状态文件写入失败：${record.summary.commandId}`, error)
    })
  }

  private async removeStateFile(commandId: string): Promise<void> {
    await fs.promises.rm(path.join(this.paths.statePath, `${commandId}.json`), { force: true }).catch(() => {})
  }

  private async reconcileOrphan(record: OrphanStateFile): Promise<void> {
    if (!record || typeof record.pid !== 'number' || !isProcessAlive(record.pid)) {
      return
    }
    const probe = this.options.probeProcess ?? defaultProbeProcess
    let info: { commandLine?: string } | null = null
    try {
      info = await probe(record.pid)
    }
    catch {
      info = null
    }
    if (!info || !matchesOrphanFingerprint(record, info.commandLine)) {
      this.options.logger?.warn(`后台命令孤儿记录校验不通过，仅清理记录：${record.commandId}`)
      return
    }
    const targetPid = record.pgid ?? record.pid
    terminateProcessTree(targetPid, 'SIGTERM')
    scheduleHardKill(targetPid)
    this.options.logger?.warn(`已回收残留的后台命令进程组：${record.commandId}`)
  }

  private killGraceMs(): number {
    return this.options.killGraceMs ?? 1_000
  }
}

interface OrphanStateFile {
  commandId: string
  pid: number
  pgid?: number
  startedAt: number
  commandFingerprint: string
  command: string
  cwd: string
}

function defaultSpawn(
  executablePath: string,
  args: readonly string[],
  options: SpawnOptionsWithoutStdio,
): ChildProcessWithoutNullStreams {
  return spawn(executablePath, args, options)
}

async function defaultProbeProcess(pid: number): Promise<{ commandLine?: string } | null> {
  if (process.platform === 'win32')
    return null
  try {
    const { stdout } = await execFileAsync('ps', ['-o', 'command=', '-p', String(pid)])
    return { commandLine: stdout.trim() }
  }
  catch {
    return null
  }
}

export function fingerprintCommand(command: string, cwd: string): string {
  return createHash('sha256').update(`${command}\0${cwd}`).digest('hex').slice(0, 32)
}

function matchesOrphanFingerprint(record: OrphanStateFile, commandLine: string | undefined): boolean {
  if (typeof record.command !== 'string' || !record.command.trim())
    return false
  if (record.commandFingerprint !== fingerprintCommand(record.command, record.cwd))
    return false
  if (typeof commandLine !== 'string' || !commandLine)
    return false
  const probe = record.command.split('\n')[0]!.trim().slice(0, 120)
  return probe.length > 0 && commandLine.includes(probe)
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  }
  catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function renderLogHeader(record: CommandRecord, secretEnv: Record<string, string> | undefined): string {
  const keys = Object.keys(secretEnv ?? {}).sort()
  const lines = [
    `# command: ${record.command}`,
    `# cwd: ${record.summary.cwd}`,
    `# pid: ${record.summary.pid ?? 'unknown'}`,
    `# startedAt: ${new Date(record.summary.startedAt).toISOString()}`,
    keys.length > 0
      ? `# secretEnv: ${keys.join(', ')} — 该后台进程持有 Turn 密钥`
      : '# secretEnv: none',
    '',
    '',
  ]
  return lines.join('\n')
}

function writeLogChunk(record: CommandRecord, text: string): void {
  if (!text)
    return
  const buffer = Buffer.from(text)
  if (record.summary.truncated || record.bytesWritten >= record.maxLogBytes) {
    markTruncated(record)
    return
  }
  const remaining = record.maxLogBytes - record.bytesWritten
  const slice = buffer.length <= remaining ? buffer : buffer.subarray(0, remaining)
  record.bytesWritten += slice.length
  record.writeStream?.write(slice)
  // 有新数据即唤醒 waitMs 等待者
  for (const waiter of [...record.waiters])
    waiter()
  if (slice.length < buffer.length)
    markTruncated(record)
}

function markTruncated(record: CommandRecord): void {
  if (record.summary.truncated)
    return
  record.summary.truncated = true
  record.writeStream?.write(TRUNCATED_MARKER)
}

function sanitizeSecretEnvironment(environment: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(environment || {}).filter(([key]) =>
    /^[A-Z_]\w*$/i.test(key) && key.toUpperCase() !== 'PATH',
  ))
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value))
    return min
  return Math.min(max, Math.max(min, Math.floor(value)))
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    timer.unref?.()
  })
}
