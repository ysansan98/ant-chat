import type { ToolApprovalWhitelistEntry } from '@ant-chat/shared'
import type { AppSettingsStore } from './appSettingsStore'
import { ToolApprovalWhitelistEntrySchema } from '@ant-chat/shared'

export class ToolApprovalWhitelistRepository {
  constructor(private readonly store: AppSettingsStore) {}

  getAll(): ToolApprovalWhitelistEntry[] {
    const settings = this.store.read()
    return settings.toolApprovalWhitelist ?? []
  }

  getForWorkspace(workspacePath: string): ToolApprovalWhitelistEntry[] {
    return this.getAll().filter(entry =>
      entry.workspacePath === undefined
      || entry.workspacePath === workspacePath,
    )
  }

  add(entry: ToolApprovalWhitelistEntry): ToolApprovalWhitelistEntry {
    const existing = this.getAll()
    const isDuplicate = existing.some(e =>
      e.toolName === entry.toolName
      && e.operationType === entry.operationType
      && e.toolScope === entry.toolScope
      && e.pattern === entry.pattern
      && e.workspacePath === entry.workspacePath,
    )
    if (isDuplicate) {
      return entry
    }
    const validated = ToolApprovalWhitelistEntrySchema.parse(entry)
    this.store.update(settings => ({
      ...settings,
      toolApprovalWhitelist: [...(settings.toolApprovalWhitelist ?? []), validated],
    }))
    return validated
  }

  remove(entry: ToolApprovalWhitelistEntry): boolean {
    let removed = false
    this.store.update((settings) => {
      const list = settings.toolApprovalWhitelist ?? []
      const filtered = list.filter(e =>
        e.toolName !== entry.toolName
        || e.operationType !== entry.operationType
        || e.toolScope !== entry.toolScope
        || e.pattern !== entry.pattern
        || e.workspacePath !== entry.workspacePath,
      )
      removed = filtered.length < list.length
      return { ...settings, toolApprovalWhitelist: filtered }
    })
    return removed
  }

  clear(): void {
    this.store.update(settings => ({ ...settings, toolApprovalWhitelist: [] }))
  }
}
