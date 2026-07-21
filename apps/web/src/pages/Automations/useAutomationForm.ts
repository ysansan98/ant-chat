import type { AutomationDefinition, AutomationInput } from '@ant-chat/shared'
import type { AutomationContextOptions, RepeatKind, ScheduleMode } from './automation-types'
import type { ModelSelectValue } from '@/components/Common/ModelSelect'
import { useEffect, useMemo, useRef } from 'react'
import { useImmer } from 'use-immer'
import { buildCron, parseCronForForm, splitCommaList, timestampToDatetimeLocal } from './automation-utils'

/** 权限开关表单状态 */
export interface PermissionFormState {
  workspaceWrite: boolean
  selectedSkillRuntime: boolean
  browser: boolean
  mcpTools: boolean
  bashCommands: boolean
}

/** 表单状态全集 */
export interface AutomationFormState {
  name: string
  prompt: string
  workspace: string
  modelValue: ModelSelectValue
  mode: ScheduleMode
  repeatKind: RepeatKind
  time: string
  onceAt: string
  selectedWeekdays: string[]
  monthDay: string
  customCron: string
  selectedSkills: string[]
  selectedMcps: string[]
  permissionScopes: PermissionFormState
  extraFileRoots: string
  bashCommandPatterns: string
}

const DEFAULT_PERMISSION_SCOPES: PermissionFormState = {
  workspaceWrite: true,
  selectedSkillRuntime: true,
  browser: false,
  mcpTools: false,
  bashCommands: false,
}

/** 一次性执行的默认时间：下一小时的整点 */
function getDefaultOnceAt(): string {
  const d = new Date()
  d.setHours(d.getHours() + 1, 0, 0, 0)
  return timestampToDatetimeLocal(d.getTime())
}

function createDefaultFormState(): AutomationFormState {
  return {
    name: '',
    prompt: '',
    workspace: '',
    modelValue: { modelId: '', providerId: '' },
    mode: 'cron',
    repeatKind: 'weekly',
    time: '09:00',
    onceAt: getDefaultOnceAt(),
    selectedWeekdays: ['1', '3', '5'],
    monthDay: '1',
    customCron: '0 9 * * 1-5',
    selectedSkills: [],
    selectedMcps: [],
    permissionScopes: { ...DEFAULT_PERMISSION_SCOPES },
    extraFileRoots: '',
    bashCommandPatterns: '',
  }
}

export function useAutomationForm(opts: {
  editingDefinition?: AutomationDefinition
  contextOptions: AutomationContextOptions
}) {
  const [form, updateForm] = useImmer<AutomationFormState>(createDefaultFormState)
  const isEditing = Boolean(opts.editingDefinition)

  // 跟踪上一次的 editingDefinition，避免闭包中引用过期的 form
  const prevDefRef = useRef(opts.editingDefinition)

  // 回填 / 重置
  useEffect(() => {
    const prevDef = prevDefRef.current
    prevDefRef.current = opts.editingDefinition

    const def = opts.editingDefinition
    if (!def) {
      // 仅当从编辑模式切换到创建模式时才重置
      if (prevDef) {
        // 新鲜的值需要重新创建
        const fresh = createDefaultFormState()
        updateForm((draft) => {
          Object.assign(draft, fresh)
        })
      }
      return
    }

    updateForm((draft) => {
      draft.name = def.name
      draft.prompt = def.prompt
      draft.workspace = def.workspacePath
      draft.modelValue = { modelId: def.modelId, providerId: def.providerId }
      draft.selectedSkills = def.allowedSkills
      draft.selectedMcps = def.allowedMcpServers

      const policy = def.permissionPolicy
      draft.permissionScopes.workspaceWrite = policy.workspaceAccess === 'write'
      draft.permissionScopes.selectedSkillRuntime = policy.allowSelectedSkillRuntime
      draft.permissionScopes.browser = policy.allowBrowser
      draft.permissionScopes.mcpTools = policy.allowMcpTools
      draft.permissionScopes.bashCommands = policy.allowBashCommands
      draft.extraFileRoots = policy.extraFileRoots.join(', ')
      draft.bashCommandPatterns = policy.bashCommandPatterns.join(', ')

      if (def.schedule.type === 'once') {
        draft.mode = 'once'
        draft.onceAt = timestampToDatetimeLocal(def.schedule.runAt)
      }
      else {
        draft.mode = 'cron'
        const parsed = parseCronForForm(def.schedule.expression)
        draft.repeatKind = parsed.repeatKind
        draft.time = parsed.time
        draft.selectedWeekdays = parsed.selectedWeekdays
        draft.monthDay = parsed.monthDay
        draft.customCron = parsed.customCron
      }
    })
  }, [opts.editingDefinition, updateForm])

  // ---- 派生值 ----

  const cron = buildCron(form.repeatKind, form.time, form.selectedWeekdays, form.monthDay, form.customCron)

  const firstModel = useMemo(
    () => opts.contextOptions.modelGroups.flatMap(
      group => group.models.map(model => ({ providerId: group.id, model })),
    )[0],
    [opts.contextOptions.modelGroups],
  )

  const effectiveWorkspace = form.workspace || opts.contextOptions.workspaces[0]?.path || ''

  const effectiveModel: ModelSelectValue = useMemo(
    () => form.modelValue.modelId
      ? form.modelValue
      : (firstModel ? { modelId: firstModel.model.id, providerId: firstModel.providerId } : { modelId: '', providerId: '' }),
    [form.modelValue, firstModel],
  )

  const modelDisplayName = useMemo(() => {
    if (!effectiveModel.modelId)
      return '选择模型'
    const p = opts.contextOptions.modelGroups.find(g => g.id === effectiveModel.providerId)
    const m = p?.models.find(mod => mod.id === effectiveModel.modelId)
    return m ? `${p!.name} · ${m.name}` : '选择模型'
  }, [effectiveModel, opts.contextOptions.modelGroups])

  const orphanedSkills = useMemo(() => {
    if (!isEditing)
      return []
    const available = new Set(opts.contextOptions.skills.filter(s => s.enabled).map(s => s.name))
    return form.selectedSkills
      .filter(s => !available.has(s))
      .map(s => ({ value: s, label: s }))
  }, [isEditing, opts.contextOptions.skills, form.selectedSkills])

  // ---- 处理函数 ----

  function toggleWeekday(day: string) {
    updateForm((draft) => {
      const idx = draft.selectedWeekdays.indexOf(day)
      if (idx >= 0) {
        if (draft.selectedWeekdays.length > 1) {
          draft.selectedWeekdays.splice(idx, 1)
        }
      }
      else {
        draft.selectedWeekdays.push(day)
      }
    })
  }

  /** 通用的多选切换辅助：从 selected 数组添加/移除值 */
  function toggleInArray(selected: string[], value: string) {
    const idx = selected.indexOf(value)
    if (idx >= 0) {
      selected.splice(idx, 1)
    }
    else {
      selected.push(value)
    }
  }

  /** 根据当前表单状态构建 AutomationInput（由外层组件在 onSubmit 中调用） */
  function buildInput(): AutomationInput {
    const { modelId, providerId } = effectiveModel
    return {
      name: form.name.trim(),
      prompt: form.prompt.trim(),
      workspacePath: effectiveWorkspace,
      providerId,
      modelId,
      allowedSkills: form.selectedSkills,
      allowedMcpServers: form.selectedMcps,
      permissionPolicy: {
        workspaceAccess: form.permissionScopes.workspaceWrite ? 'write' as const : 'read' as const,
        allowSelectedSkillRuntime: form.permissionScopes.selectedSkillRuntime,
        allowBrowser: form.permissionScopes.browser,
        allowMcpTools: form.permissionScopes.mcpTools,
        extraFileRoots: splitCommaList(form.extraFileRoots),
        allowBashCommands: form.permissionScopes.bashCommands,
        bashCommandPatterns: splitCommaList(form.bashCommandPatterns),
      },
      schedule: form.mode === 'cron'
        ? { type: 'cron' as const, expression: cron, timezone: 'Asia/Shanghai' }
        : { type: 'once' as const, runAt: new Date(form.onceAt).getTime() },
      enabled: true,
    }
  }

  return {
    form,
    updateForm,
    isEditing,
    cron,
    effectiveWorkspace,
    effectiveModel,
    modelDisplayName,
    orphanedSkills,
    toggleWeekday,
    toggleInArray,
    buildInput,
  }
}
