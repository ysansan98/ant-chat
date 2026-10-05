import type { HookConfigSource, HookEvent, HookMatcherGroup, IHookDispatcher } from '@ant-chat/shared'
import { emptyHookResult } from '@ant-chat/shared'

/**
 * Hooks 协议类型统一由 shared 定义（AgentRuntimeConfig 需要引用），
 * 这里 re-export 并提供 backend 专属的装配类型与 no-op 实现。
 */
export {
  DEFAULT_HOOK_TIMEOUT_MS,
  defaultHookTimeoutMs,
  emptyHookResult,
  emptyHooksFile,
  FAST_HOOK_EVENTS,
  FAST_HOOK_TIMEOUT_MS,
  HOOK_EVENTS,
  HookCommandHandlerSchema,
  HookMatcherGroupSchema,
  HOOKS_SCHEMA_VERSION,
  HooksFileSchema,
  normalizeDecision,
  SESSION_HOOK_EVENTS,
  TOOL_HOOK_EVENTS,
  TOOL_HOOK_TIMEOUT_MS,
} from '@ant-chat/shared'

export type {
  HookAggregateResult,
  HookCommandHandler,
  HookConfigSource,
  HookDecision,
  HookDispatchOptions,
  HookEvent,
  HookHandlerExecution,
  HookInput,
  HookInputBase,
  HookMatcherGroup,
  HooksFile,
  IHookDispatcher,
  NormalizedHookDecision,
} from '@ant-chat/shared'

/** global 与 workspace 的匹配项都执行；source 用于观测与告警。 */
export interface ResolvedHookGroup {
  source: HookConfigSource
  group: HookMatcherGroup
}

/** 未配置 hooks 时的默认实现：行为与现状 bit-for-bit 一致。 */
export function createNoopHookDispatcher(): IHookDispatcher {
  return {
    async run(event: HookEvent) {
      return emptyHookResult(event)
    },
  }
}
