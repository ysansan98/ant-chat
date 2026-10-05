import type { ILogger } from '@ant-chat/shared'
import type { HookConfigSource, HookEvent, HooksFile, ResolvedHookGroup } from './types'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { emptyHooksFile, HooksFileSchema } from './types'

/** 工作区 hooks 相对路径：<workspace>/.agents/hooks.json */
export const WORKSPACE_HOOKS_RELATIVE_PATH = path.join('.agents', 'hooks.json')

export interface HookConfigStoreOptions {
  /** 全局 hooks 文件（~/.ant-chat/hooks.json）。 */
  globalFilePath: string
  logger?: ILogger
  /** 工作区 hooks 路径解析；测试可覆盖。 */
  resolveWorkspaceHooksPath?: (workspacePath: string) => string
}

/**
 * 两层 hooks 配置加载。
 *
 * - global：~/.ant-chat/hooks.json
 * - workspace：<workspace>/.agents/hooks.json
 *
 * global 与 workspace 的匹配项都执行（workspace 不能删除 global），
 * 只有 deny/ask 这类收紧结论在 dispatcher 中跨源聚合。
 *
 * 读取失败（缺失/损坏）一律按"无 hook"处理并隔离损坏文件：
 * hook 是增强能力，配置损坏不能阻塞主流程。
 */
export class HookConfigStore {
  private readonly globalFilePath: string
  private readonly logger?: ILogger
  private readonly resolveWorkspaceHooksPath: (workspacePath: string) => string

  constructor(options: HookConfigStoreOptions) {
    this.globalFilePath = options.globalFilePath
    this.logger = options.logger
    this.resolveWorkspaceHooksPath = options.resolveWorkspaceHooksPath
      ?? (workspacePath => path.join(workspacePath, WORKSPACE_HOOKS_RELATIVE_PATH))
  }

  getGlobalFilePath(): string {
    return this.globalFilePath
  }

  getWorkspaceFilePath(workspacePath: string): string {
    return this.resolveWorkspaceHooksPath(workspacePath)
  }

  /** 读取指定来源的配置；任何失败都返回空配置，不抛出。 */
  readSource(source: HookConfigSource, workspacePath: string): HooksFile {
    const filePath = source === 'global'
      ? this.globalFilePath
      : this.resolveWorkspaceHooksPath(workspacePath)
    return this.readFile(filePath, source)
  }

  /** 解析单个事件应执行的全部 handler 分组（global 在前，workspace 在后）。 */
  resolveForEvent(event: HookEvent, workspacePath: string): ResolvedHookGroup[] {
    return [
      ...this.toResolved('global', this.readSource('global', workspacePath), event),
      ...this.toResolved('workspace', this.readSource('workspace', workspacePath), event),
    ]
  }

  private toResolved(source: HookConfigSource, file: HooksFile, event: HookEvent): ResolvedHookGroup[] {
    const groups = file.hooks[event]
    if (!groups?.length)
      return []
    return groups.map(group => ({ source, group }))
  }

  private readFile(filePath: string, source: HookConfigSource): HooksFile {
    if (!fs.existsSync(filePath))
      return emptyHooksFile()

    let raw: unknown
    try {
      raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    }
    catch (error) {
      this.quarantine(filePath, source, '不是有效 JSON', error)
      return emptyHooksFile()
    }

    const parsed = HooksFileSchema.safeParse(raw)
    if (!parsed.success) {
      this.quarantine(filePath, source, `schema 校验失败：${parsed.error.message}`, parsed.error)
      return emptyHooksFile()
    }
    return parsed.data
  }

  /** 保留损坏证据后按"无 hook"继续；不重建文件，避免制造隐式空配置。 */
  private quarantine(filePath: string, source: HookConfigSource, message: string, cause: unknown): void {
    let quarantinedPath: string | undefined
    try {
      if (fs.existsSync(filePath)) {
        quarantinedPath = `${filePath}.corrupted-${Date.now()}-${randomUUID()}`
        fs.renameSync(filePath, quarantinedPath)
      }
    }
    catch (renameError) {
      this.logger?.warn(`hooks 配置（${source}）损坏隔离失败，按无 hook 继续`, { filePath, cause, renameError })
      return
    }
    this.logger?.warn(
      `hooks 配置（${source}）无法读取，已隔离并按无 hook 继续：${message}`,
      { filePath, quarantinedPath, cause },
    )
  }
}
