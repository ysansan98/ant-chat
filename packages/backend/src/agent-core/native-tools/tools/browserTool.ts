import type {
  AgentBrowserRuntimeConfig,
  BrowserAuthStateProvider,
  BrowserBackInput,
  BrowserClickInput,
  BrowserCloseInput,
  BrowserDialogInput,
  BrowserEvalInput,
  BrowserNavigateInput,
  BrowserPressInput,
  BrowserReloadInput,
  BrowserScrollInput,
  BrowserSnapshotInput,
  BrowserToolInput,
  BrowserTypeInput,
} from '@ant-chat/shared'
import type { BrowserSessionState } from './browserSessionManager'
import { runBrowserTool, validateBrowserInput } from './browserRunner'
import { createNativeTool } from './toolFactory'

/** browser_* 工厂共享的运行时配置（workspacePath + agent runtime config + 会话状态） */
interface BrowserToolFactoryOptions {
  workspacePath: string
  config: AgentBrowserRuntimeConfig
  state: BrowserSessionState
  authStateProvider?: BrowserAuthStateProvider
}

/**
 * 将类型化的浏览器工具 input 映射回底层 BrowserToolInput（command + args）。
 * 拆分后的 11 个工具在此层做命令映射和参数组装，browserRunner 层只负责执行。
 */

function toBrowserInput(command: string, args: string[], timeoutMs?: number, injectCookies?: boolean): BrowserToolInput {
  return { command, args, timeoutMs, ...(injectCookies !== undefined ? { injectCookies } : {}) }
}

/** 校验映射后的 BrowserToolInput（底层 46 命令白名单兜底） */
function validateMappedInput(
  mapped: BrowserToolInput,
  options: BrowserToolFactoryOptions,
): string | null {
  return validateBrowserInput(mapped, {
    workspacePath: options.workspacePath,
    artifactsPath: options.config.artifactsPath,
  })
}

/** 执行映射后的 BrowserToolInput */
async function executeMapped(
  mapped: BrowserToolInput,
  options: BrowserToolFactoryOptions,
): ReturnType<typeof runBrowserTool> {
  return runBrowserTool(mapped, {
    ...options.config,
    workspacePath: options.workspacePath,
    proxyUrl: options.config.proxyUrl,
    state: options.state,
    authStateProvider: options.authStateProvider,
  })
}

/** 推断 scope：仅 browser_navigate 带 --profile 时为 outside，其余为 external */
function inferBrowserScope(args: string[]): 'external' | 'outside' {
  return args.includes('--profile') ? 'outside' : 'external'
}

// ---- 11 个浏览器工具工厂 ----

export function createBrowserNavigateTool(options: BrowserToolFactoryOptions) {
  return createNativeTool({
    name: 'browser_navigate',
    operationType: 'browser',
    description: [
      '在独立浏览器会话中打开 URL。',
      '浏览器会话按对话隔离：同一对话的命令复用同一实例，不同对话互不共享窗口、Cookies 与页面状态。',
      '会话不持久化：关闭浏览器或对话结束后，登录态与页面状态即失效。',
      '用户需要完成登录、验证码或双因素认证时使用 headed。',
      '默认注入应用托管的登录 Cookies；需要以未登录状态访问时设置 injectCookies=false。',
      '不要索要、接收或输入账户密码；请打开可见浏览器，由用户直接输入凭据。',
      '只有用户明确要求复用系统 Chrome Profile 时才设置 profile。',
    ].join('\n'),
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '要打开的 HTTP 或 HTTPS URL。' },
        headed: { type: 'boolean', description: '打开可见浏览器窗口供用户手动交互。' },
        profile: { type: 'string', description: '系统 Chrome Profile 名称，仅在用户明确要求时使用。' },
        injectCookies: { type: 'boolean', description: '是否注入应用托管的登录 Cookies，默认 true；设为 false 时以未登录状态打开。' },
        timeoutMs: { type: 'number', description: '执行超时毫秒数，最大为 300000。' },
      },
      required: ['url'],
    },
    unrestricted: true,
    inferScope: (rawInput) => {
      const url = typeof rawInput.url === 'string' ? rawInput.url : ''
      const args: string[] = [url]
      if (rawInput.headed)
        args.push('--headed')
      if (typeof rawInput.profile === 'string' && rawInput.profile) {
        args.push('--profile', rawInput.profile)
      }
      return inferBrowserScope(args)
    },
    validateInput: (rawInput) => {
      const input = rawInput as unknown as BrowserNavigateInput
      if (typeof input.url !== 'string' || !input.url.trim()) {
        return 'url 必须是非空字符串'
      }
      const args: string[] = [input.url]
      if (input.headed)
        args.push('--headed')
      if (typeof input.profile === 'string' && input.profile) {
        args.push('--profile', input.profile)
      }
      return validateMappedInput(toBrowserInput('open', args, input.timeoutMs, input.injectCookies), options)
    },
    execute: async (rawInput) => {
      const input = rawInput as unknown as BrowserNavigateInput
      const args: string[] = [input.url]
      if (input.headed)
        args.push('--headed')
      if (typeof input.profile === 'string' && input.profile) {
        args.push('--profile', input.profile)
      }
      return executeMapped(toBrowserInput('open', args, input.timeoutMs, input.injectCookies), options)
    },
    truncateResult: false,
  })
}

export function createBrowserBackTool(options: BrowserToolFactoryOptions) {
  return createNativeTool({
    name: 'browser_back',
    operationType: 'browser',
    description: '在浏览器历史记录中后退。',
    inputSchema: {
      type: 'object',
      properties: {
        timeoutMs: { type: 'number', description: '执行超时毫秒数，最大为 300000。' },
      },
      required: [],
    },
    unrestricted: true,
    inferScope: () => 'external',
    validateInput: (rawInput) => {
      const input = rawInput as unknown as BrowserBackInput
      return validateMappedInput(toBrowserInput('back', [], input.timeoutMs), options)
    },
    execute: async (rawInput) => {
      const input = rawInput as unknown as BrowserBackInput
      return executeMapped(toBrowserInput('back', [], input.timeoutMs), options)
    },
    truncateResult: false,
  })
}

export function createBrowserReloadTool(options: BrowserToolFactoryOptions) {
  return createNativeTool({
    name: 'browser_reload',
    operationType: 'browser',
    description: '刷新当前页面。',
    inputSchema: {
      type: 'object',
      properties: {
        timeoutMs: { type: 'number', description: '执行超时毫秒数，最大为 300000。' },
      },
      required: [],
    },
    unrestricted: true,
    inferScope: () => 'external',
    validateInput: (rawInput) => {
      const input = rawInput as unknown as BrowserReloadInput
      return validateMappedInput(toBrowserInput('reload', [], input.timeoutMs), options)
    },
    execute: async (rawInput) => {
      const input = rawInput as unknown as BrowserReloadInput
      return executeMapped(toBrowserInput('reload', [], input.timeoutMs), options)
    },
    truncateResult: false,
  })
}

export function createBrowserCloseTool(options: BrowserToolFactoryOptions) {
  return createNativeTool({
    name: 'browser_close',
    operationType: 'browser',
    description: '关闭浏览器并终止其守护进程。',
    inputSchema: {
      type: 'object',
      properties: {
        timeoutMs: { type: 'number', description: '执行超时毫秒数，最大为 300000。' },
      },
      required: [],
    },
    unrestricted: true,
    inferScope: () => 'external',
    validateInput: (rawInput) => {
      const input = rawInput as unknown as BrowserCloseInput
      return validateMappedInput(toBrowserInput('close', [], input.timeoutMs), options)
    },
    execute: async (rawInput) => {
      const input = rawInput as unknown as BrowserCloseInput
      return executeMapped(toBrowserInput('close', [], input.timeoutMs), options)
    },
    truncateResult: false,
  })
}

export function createBrowserSnapshotTool(options: BrowserToolFactoryOptions) {
  return createNativeTool({
    name: 'browser_snapshot',
    operationType: 'browser',
    description: [
      '获取页面的无障碍树文本。',
      '导航或 DOM 变化后，应先获取快照再使用 @eN 引用交互。',
    ].join('\n'),
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: '用于限定快照范围的 CSS 选择器。' },
        timeoutMs: { type: 'number', description: '执行超时毫秒数，最大为 300000。' },
      },
      required: [],
    },
    unrestricted: true,
    inferScope: () => 'external',
    validateInput: (rawInput) => {
      const input = rawInput as unknown as BrowserSnapshotInput
      const args: string[] = []
      if (input.selector)
        args.push('--selector', input.selector)
      return validateMappedInput(toBrowserInput('snapshot', args, input.timeoutMs), options)
    },
    execute: async (rawInput) => {
      const input = rawInput as unknown as BrowserSnapshotInput
      const args: string[] = []
      if (input.selector)
        args.push('--selector', input.selector)
      return executeMapped(toBrowserInput('snapshot', args, input.timeoutMs), options)
    },
    truncateResult: false,
  })
}

export function createBrowserClickTool(options: BrowserToolFactoryOptions) {
  return createNativeTool({
    name: 'browser_click',
    operationType: 'browser',
    description: '点击由快照 @eN 引用或 CSS 选择器标识的页面元素。',
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: '最新快照中的元素引用，例如 @e3。' },
        selector: { type: 'string', description: '作为 ref 替代的 CSS 选择器。' },
        newTab: { type: 'boolean', description: '在新标签页打开链接。' },
        timeoutMs: { type: 'number', description: '执行超时毫秒数，最大为 300000。' },
      },
      required: [],
    },
    unrestricted: true,
    inferScope: () => 'external',
    validateInput: (rawInput) => {
      const input = rawInput as unknown as BrowserClickInput
      const target = input.ref || input.selector
      if (!target) {
        return '必须提供 ref 或 selector'
      }
      const args: string[] = [target]
      if (input.newTab)
        args.push('--new-tab')
      return validateMappedInput(toBrowserInput('click', args, input.timeoutMs), options)
    },
    execute: async (rawInput) => {
      const input = rawInput as unknown as BrowserClickInput
      const target = input.ref || input.selector || ''
      const args: string[] = [target]
      if (input.newTab)
        args.push('--new-tab')
      return executeMapped(toBrowserInput('click', args, input.timeoutMs), options)
    },
    truncateResult: false,
  })
}

export function createBrowserTypeTool(options: BrowserToolFactoryOptions) {
  return createNativeTool({
    name: 'browser_type',
    operationType: 'browser',
    description: '向由 @eN 引用或 CSS 选择器标识的输入元素填入文本。',
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: '最新快照中的元素引用，例如 @e3。' },
        selector: { type: 'string', description: '作为 ref 替代的 CSS 选择器。' },
        text: { type: 'string', description: '要填入元素的文本。' },
        timeoutMs: { type: 'number', description: '执行超时毫秒数，最大为 300000。' },
      },
      required: ['text'],
    },
    unrestricted: true,
    inferScope: () => 'external',
    validateInput: (rawInput) => {
      const input = rawInput as unknown as BrowserTypeInput
      const target = input.ref || input.selector
      if (!target) {
        return '必须提供 ref 或 selector'
      }
      if (typeof input.text !== 'string') {
        return 'text 必须是字符串'
      }
      const args: string[] = [target, input.text]
      return validateMappedInput(toBrowserInput('fill', args, input.timeoutMs), options)
    },
    execute: async (rawInput) => {
      const input = rawInput as unknown as BrowserTypeInput
      const target = input.ref || input.selector || ''
      const args: string[] = [target, input.text]
      return executeMapped(toBrowserInput('fill', args, input.timeoutMs), options)
    },
    truncateResult: false,
  })
}

export function createBrowserPressTool(options: BrowserToolFactoryOptions) {
  return createNativeTool({
    name: 'browser_press',
    operationType: 'browser',
    description: '按下按键或组合键，例如 Enter、Tab、Control+a。',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: '要按下的按键或组合键，例如 Enter、Tab、Control+a。' },
        timeoutMs: { type: 'number', description: '执行超时毫秒数，最大为 300000。' },
      },
      required: ['key'],
    },
    unrestricted: true,
    inferScope: () => 'external',
    validateInput: (rawInput) => {
      const input = rawInput as unknown as BrowserPressInput
      if (typeof input.key !== 'string' || !input.key.trim()) {
        return 'key 必须是非空字符串'
      }
      return validateMappedInput(toBrowserInput('press', [input.key], input.timeoutMs), options)
    },
    execute: async (rawInput) => {
      const input = rawInput as unknown as BrowserPressInput
      return executeMapped(toBrowserInput('press', [input.key], input.timeoutMs), options)
    },
    truncateResult: false,
  })
}

export function createBrowserScrollTool(options: BrowserToolFactoryOptions) {
  return createNativeTool({
    name: 'browser_scroll',
    operationType: 'browser',
    description: '按指定方向和距离滚动页面，默认向下滚动 300px。',
    inputSchema: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['up', 'down', 'left', 'right'], description: '滚动方向，默认向下。' },
        amount: { type: 'number', description: '滚动像素量，默认 300。' },
        selector: { type: 'string', description: '将滚动范围限定到特定元素的 CSS 选择器。' },
        timeoutMs: { type: 'number', description: '执行超时毫秒数，最大为 300000。' },
      },
      required: [],
    },
    unrestricted: true,
    inferScope: () => 'external',
    validateInput: (rawInput) => {
      const input = rawInput as unknown as BrowserScrollInput
      const args = buildScrollArgs(input)
      return validateMappedInput(toBrowserInput('scroll', args, input.timeoutMs), options)
    },
    execute: async (rawInput) => {
      const input = rawInput as unknown as BrowserScrollInput
      const args = buildScrollArgs(input)
      return executeMapped(toBrowserInput('scroll', args, input.timeoutMs), options)
    },
    truncateResult: false,
  })
}

function buildScrollArgs(input: BrowserScrollInput): string[] {
  const pixelAmount = input.amount ?? 300
  let scrollValue: number
  switch (input.direction) {
    case 'up':
      scrollValue = -pixelAmount
      break
    case 'left':
      scrollValue = -pixelAmount
      break
    case 'right':
      scrollValue = pixelAmount
      break
    default:
      scrollValue = pixelAmount
      break
  }
  const args: string[] = [String(scrollValue)]
  if (input.selector)
    args.push('--selector', input.selector)
  return args
}

export function createBrowserDialogTool(options: BrowserToolFactoryOptions) {
  return createNativeTool({
    name: 'browser_dialog',
    operationType: 'browser',
    description: '接受或关闭浏览器对话框（alert、confirm、prompt）。',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['accept', 'dismiss'], description: '接受或关闭对话框。' },
        text: { type: 'string', description: 'prompt 对话框要输入的文本，仅能与 accept 一起使用。' },
        timeoutMs: { type: 'number', description: '执行超时毫秒数，最大为 300000。' },
      },
      required: ['action'],
    },
    unrestricted: true,
    inferScope: () => 'external',
    validateInput: (rawInput) => {
      const input = rawInput as unknown as BrowserDialogInput
      if (input.action !== 'accept' && input.action !== 'dismiss') {
        return 'action 必须是 accept 或 dismiss'
      }
      const command = input.action === 'accept' ? 'dialog accept' : 'dialog dismiss'
      const args: string[] = typeof input.text === 'string' && input.text ? [input.text] : []
      return validateMappedInput(toBrowserInput(command, args, input.timeoutMs), options)
    },
    execute: async (rawInput) => {
      const input = rawInput as unknown as BrowserDialogInput
      const command = input.action === 'accept' ? 'dialog accept' : 'dialog dismiss'
      const args: string[] = typeof input.text === 'string' && input.text ? [input.text] : []
      return executeMapped(toBrowserInput(command, args, input.timeoutMs), options)
    },
    truncateResult: false,
  })
}

export function createBrowserEvalTool(options: BrowserToolFactoryOptions) {
  return createNativeTool({
    name: 'browser_eval',
    operationType: 'browser',
    description: [
      '在页面上下文中执行 JavaScript。',
      '只有快照和语义化元素操作无法读取所需页面内容时才使用。',
      '表达式运行在页面中，而不是浏览器界面中。',
    ].join('\n'),
    inputSchema: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: '要在页面中执行的 JavaScript 表达式。' },
        timeoutMs: { type: 'number', description: '执行超时毫秒数，最大为 300000。' },
      },
      required: ['expression'],
    },
    unrestricted: true,
    inferScope: () => 'external',
    validateInput: (rawInput) => {
      const input = rawInput as unknown as BrowserEvalInput
      if (typeof input.expression !== 'string' || !input.expression.trim()) {
        return 'expression 必须是非空字符串'
      }
      return validateMappedInput(toBrowserInput('eval', [input.expression], input.timeoutMs), options)
    },
    execute: async (rawInput) => {
      const input = rawInput as unknown as BrowserEvalInput
      return executeMapped(toBrowserInput('eval', [input.expression], input.timeoutMs), options)
    },
    truncateResult: false,
  })
}
