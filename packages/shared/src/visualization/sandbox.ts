import { validateVisualizationHtmlFragment } from '../schemas/visualization'

export const VISUALIZATION_CSP = 'default-src \'none\'; connect-src \'none\'; img-src data:; media-src \'none\'; font-src \'none\'; frame-src \'none\'; object-src \'none\'; base-uri \'none\'; form-action \'none\'; worker-src \'none\''

export function createVisualizationSandboxShell(options: {
  fragment: string
  css: string
  runtime: string
  cdnOrigins: readonly string[]
}): string {
  const policyError = validateVisualizationHtmlFragment(options.fragment)
  if (policyError)
    throw new Error(`可视化 HTML 校验失败：${policyError}`)
  // fragment 运行在 opaque-origin iframe 中，只能经受控 MessagePort 请求 follow-up。
  // 因此允许内联样式和事件属性，避免模型为等价写法产生失败重试。
  const csp = `${VISUALIZATION_CSP}; script-src 'unsafe-inline' ${options.cdnOrigins.join(' ')}; style-src 'unsafe-inline' ${options.cdnOrigins.join(' ')}`
  const runtime = options.runtime.replace(/<\/script/gi, '<\\/script')
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>${options.css}</style><style id="ant-chat-viz-theme"></style></head><body><main class="viz-root">${options.fragment}</main><script>${runtime}</script></body></html>`
}
