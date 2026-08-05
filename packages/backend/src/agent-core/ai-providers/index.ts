/**
 * AI 提供商模块主入口
 * 统一导出所有 AI 提供商相关的类型和实现。
 * 订阅型提供商（Codex 等）各自收敛在子目录，经 codex/ 入口再导出。
 */

export * from './codex'
export { createAProvider, MultiProvider } from './multi-provider'
export type { ProviderFormat } from './types'
