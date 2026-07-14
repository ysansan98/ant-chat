/* eslint-disable better-tailwindcss/enforce-consistent-class-order, better-tailwindcss/no-duplicate-classes, better-tailwindcss/no-unknown-classes */
import { visualizationRuntimeSource } from './runtime/runtimeSource'

export const VISUALIZATION_CSP = 'default-src \'none\'; connect-src \'none\'; img-src data:; media-src \'none\'; font-src \'none\'; frame-src \'none\'; object-src \'none\'; base-uri \'none\'; form-action \'none\'; worker-src \'none\''

function createNonce(): string {
  const bytes = new Uint8Array(16)
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes)
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  }
  return 'ant-chat-visualization'
}

export function createVisualizationSandboxDocument(): string {
  const nonce = createNonce()
  const csp = `${VISUALIZATION_CSP}; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'`
  const styles = `
    :root { color-scheme: light; background: var(--viz-background, transparent); color: var(--viz-foreground, currentColor); font: 14px/1.5 ui-sans-serif, system-ui, sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 16px; background: var(--viz-background, transparent); color: var(--viz-foreground, currentColor); }
    .viz-root { max-width: 704px; margin: 0 auto; }
    h2, h3 { margin: 0 0 8px; font-weight: 600; text-wrap: balance; }
    p { margin: 0 0 12px; color: var(--viz-muted, currentColor); text-wrap: pretty; }
    .viz-section { margin-top: 20px; }
    .viz-section:first-of-type { margin-top: 16px; }
    .viz-section > svg { display: block; width: 100%; height: auto; overflow: visible; }
    .viz-flow, .viz-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .viz-timeline, .viz-swimlane-track { list-style: none; margin: 0; padding: 0; }
    .viz-timeline { position: relative; display: grid; gap: 10px; }
    .viz-timeline::before { content: ''; position: absolute; top: 0; bottom: 0; left: 8px; border-left: 2px solid var(--viz-border, currentColor); }
    .viz-timeline-item { position: relative; display: grid; grid-template-columns: 18px minmax(0, 1fr); gap: 10px; align-items: start; }
    .viz-timeline-marker { z-index: 1; width: 18px; height: 18px; border: 4px solid var(--viz-card, transparent); border-radius: 50%; background: var(--viz-primary, currentColor); }
    .viz-timeline-card, .viz-swimlane-card { display: grid; gap: 2px; padding: 10px 12px; border: 1px solid var(--viz-border, currentColor); border-radius: 8px; background: var(--viz-card, transparent); }
    .viz-timeline-card span, .viz-swimlane-card span { color: var(--viz-muted, currentColor); font-size: 12px; }
    .viz-swimlane { display: grid; grid-template-columns: minmax(90px, 0.3fr) minmax(0, 1fr); gap: 12px; align-items: start; padding: 10px 0; border-bottom: 1px solid var(--viz-border, currentColor); }
    .viz-swimlane h4 { margin: 10px 0 0; }
    .viz-swimlane-track { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; }
    button, input, select, textarea { min-height: 40px; max-width: 100%; font: inherit; }
    button { border: 1px solid var(--viz-border, currentColor); border-radius: 8px; padding: 7px 12px; background: var(--viz-card, transparent); color: var(--viz-foreground, currentColor); cursor: pointer; transition: transform 120ms ease, background-color 120ms ease; }
    button:hover { background: color-mix(in srgb, var(--viz-primary, currentColor) 10%, transparent); }
    button:active { transform: scale(.96); }
    button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 2px solid var(--viz-primary, currentColor); outline-offset: 2px; }
    form { display: grid; gap: 12px; max-width: 560px; }
    form label { display: grid; gap: 6px; color: var(--viz-foreground, currentColor); }
    input, select, textarea { width: 100%; border: 1px solid var(--viz-border, currentColor); border-radius: 8px; padding: 8px 10px; background: var(--viz-card, transparent); color: var(--viz-foreground, currentColor); }
    input[type=checkbox] { width: 20px; }
    input[type=range] { accent-color: var(--viz-primary, currentColor); }
    textarea { min-height: 96px; resize: vertical; }
    table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
    th, td { padding: 8px; border-bottom: 1px solid var(--viz-border, currentColor); text-align: left; }
    th { color: var(--viz-muted, currentColor); font-weight: 500; }
    .viz-error { color: var(--viz-destructive, currentColor); min-height: 1.5em; }
    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; transition-duration: 0.001ms !important; animation-duration: 0.001ms !important; } }
    @media (max-width: 420px) { body { padding: 12px; } .viz-flow { align-items: stretch; } .viz-flow button { flex: 1 1 100%; } .viz-flow span { display: none; } }
  `
  const runtime = visualizationRuntimeSource.replace(/<\/script/gi, '<\\/script')
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style nonce="${nonce}">${styles}</style></head><body><script nonce="${nonce}">${runtime}</script></body></html>`
}
