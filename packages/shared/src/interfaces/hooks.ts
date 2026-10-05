import type { HookAggregateResult, HookEvent, HookInput } from '../schemas/hooks'

export interface HookDispatchOptions {
  cwd: string
  /** 调用方中断信号；hook 不应在会话取消后继续等待。 */
  signal?: AbortSignal
}

/**
 * Agent 内部只依赖这个窄接口；未配置 hooks 时注入 no-op 实现。
 * 具体实现由 backend 的 hooks 运行时提供。
 */
export interface IHookDispatcher {
  run: (event: HookEvent, input: HookInput, options: HookDispatchOptions) => Promise<HookAggregateResult>
}
