import type {
  AddMcpConfigSchema,
  AutomationDefinition,
  AutomationInput,
  AutomationRun,
  CreateProviderConfigSchema,
  GeneralSettingsState,
  McpConfigSchema,
  McpConnection,
  McpServerEditPatch,
  McpServerLifecycleResult,
  ProviderConfigModelSchema,
  ProviderConfigSchema,
  UpdateProviderConfigSchema,
} from '@ant-chat/shared'

/**
 * 控制面与运行时模块之间的 seam。
 *
 * AppControl 只依赖这里声明的方法，不直接耦合具体运行时模块类，
 * 使控制面命令映射与运行时实现可独立演化。运行时模块通过结构化
 * 类型满足本接口：被控制面复用的读取方法 input 声明为可选，故可
 * 无参调用（RPC 调度仍照常传 input）。
 *
 * 控制面专属能力（MCP 生命周期、automation 安全删除）也在此声明，
 * 让「控制面需要什么」一目了然，而不是散落在各模块的公开方法里。
 */
export interface ControlPlaneModules {
  settings: SettingsControlPlane
  provider: ProviderControlPlane
  mcp: McpControlPlane
  automation: AutomationControlPlane
}

export interface SettingsControlPlane {
  getSettings: () => Promise<GeneralSettingsState>
  updateSettings: (input: { updates: Partial<GeneralSettingsState> }) => Promise<GeneralSettingsState>
  testProxyConnection: (input: { proxyUrl: string }) => Promise<boolean>
}

export interface ProviderControlPlane {
  listProviders: () => ProviderConfigSchema[]
  getProviderById: (input: { id: string }) => ProviderConfigSchema
  createProvider: (input: { config: CreateProviderConfigSchema }) => Promise<ProviderConfigSchema>
  updateProvider: (input: { config: UpdateProviderConfigSchema }) => Promise<ProviderConfigSchema>
  deleteProvider: (input: { id: string }) => Promise<null>
  listProviderModels: (input: { id: string }) => ProviderConfigModelSchema[]
}

export interface McpControlPlane {
  getConfigs: () => McpConfigSchema[]
  getConnections: () => McpConnection[]
  getConfigByServerName: (input: { serverName: string }) => McpConfigSchema
  /** 安装配置并尝试连接；启动失败时保留配置并返回实际状态。 */
  installServer: (input: { config: AddMcpConfigSchema }) => Promise<McpServerLifecycleResult>
  /** 编辑配置，运行中自动重连；已停止则只更新配置。 */
  editServer: (input: { serverName: string, updates: McpServerEditPatch }) => Promise<McpServerLifecycleResult>
  /** 删除配置，运行中先断开再删。 */
  deleteServer: (input: { serverName: string }) => Promise<McpServerLifecycleResult>
  /** 按名称启动（从持久化配置读取连接）。 */
  startServer: (input: { serverName: string }) => Promise<McpServerLifecycleResult>
  /** 按名称停止（幂等）。 */
  stopServer: (input: { serverName: string }) => Promise<McpServerLifecycleResult>
}

export interface AutomationControlPlane {
  list: () => Promise<AutomationDefinition[]>
  get: (id: string) => Promise<AutomationDefinition>
  create: (input: { input: AutomationInput }) => Promise<AutomationDefinition>
  /** 安全删除 — 检查活跃 run 并支持 force。 */
  safeDelete: (id: string, force?: boolean) => Promise<void>
  listRuns: (input: { automationId?: string, limit?: number }) => Promise<AutomationRun[]>
}
