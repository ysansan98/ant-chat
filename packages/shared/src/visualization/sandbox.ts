import { validateVisualizationHtmlFragment } from '../schemas/visualization'

export const VISUALIZATION_CSP = 'default-src \'none\'; connect-src \'none\'; img-src data:; media-src \'none\'; font-src \'none\'; frame-src \'none\'; object-src \'none\'; base-uri \'none\'; form-action \'none\'; worker-src \'none\''

export function createVisualizationSandboxShell(options: {
  fragment: string
  css: string
  runtime: string
  cdnOrigins: readonly string[]
  nonce?: string
}): string {
  const policyError = validateVisualizationHtmlFragment(options.fragment)
  if (policyError)
    throw new Error(`可视化 HTML 校验失败：${policyError}`)
  const nonce = options.nonce ?? createNonce()
  const csp = `${VISUALIZATION_CSP}; script-src 'nonce-${nonce}' ${options.cdnOrigins.join(' ')}; style-src 'nonce-${nonce}' ${options.cdnOrigins.join(' ')}`
  let fragment = addNonce(options.fragment, 'script', nonce)
  fragment = addNonce(fragment, 'style', nonce)
  const runtime = options.runtime.replace(/<\/script/gi, '<\\/script')
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style nonce="${nonce}">${options.css}</style></head><body><main class="viz-root">${fragment}</main><script nonce="${nonce}">${runtime}</script></body></html>`
}

function createNonce(): string {
  const bytes = new Uint8Array(16)
  if (globalThis.crypto?.getRandomValues)
    globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('') || 'ant-chat-visualization'
}

function addNonce(fragment: string, tag: 'script' | 'style', nonce: string): string {
  const pattern = new RegExp(`<${tag}\\b(?![^>]*\\bnonce=)([^>]*)>`, 'gi')
  return fragment.replace(pattern, `<${tag} nonce="${nonce}"$1>`)
}
